// AVIF の解析と復号は libavif / dav1d に委ねる。親プロセスが実行時間を制限する。
#include <avif/avif.h>
#include <dav1d/dav1d.h>
#include <errno.h>
#include <inttypes.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#ifdef _WIN32
#include <windows.h>
#include <malloc.h>
#include <psapi.h>
#endif

#define INPUT_LIMIT (25u * 1024u * 1024u)
#define OUTPUT_LIMIT (1024u * 1024u)
#define LIVE_BYTE_LIMIT (512u * 1024u * 1024u)
#define PROCESS_BYTE_LIMIT (1024u * 1024u * 1024u)
typedef struct { uint32_t pixels, dimension, frames; uint64_t cumulative; } Limits;
typedef struct { Limits limits; uint64_t pixels, live_bytes, peak_bytes; } AllocationBudget;
static AllocationBudget allocation_budget;
static int process_memory_budget_enabled;
typedef struct {
    uint32_t width, height, display_width, display_height, browser_width, browser_height, depth;
    int frames, repetition;
    avifBool alpha, progressive, gainMap;
    uint16_t primaries, transfer, matrix;
    uint64_t timescale, duration;
} Summary;
typedef struct { char *data; size_t length; } Output;

// dav1d の公式 allocator 契約に従う。パーサーや codec は変更しない。
// maxThreads=1 のため callback は dav1d_get_picture のスレッドで実行される。
static int allocate_picture(Dav1dPicture *picture, void *cookie) {
    AllocationBudget *budget = (AllocationBudget *)cookie;
    if (picture->p.w <= 0 || picture->p.h <= 0 ||
        (uint32_t)picture->p.w > budget->limits.dimension || (uint32_t)picture->p.h > budget->limits.dimension ||
        (picture->p.bpc != 8 && picture->p.bpc != 10 && picture->p.bpc != 12) ||
        picture->p.layout < DAV1D_PIXEL_LAYOUT_I400 || picture->p.layout > DAV1D_PIXEL_LAYOUT_I444) return -ENOMEM;
    uint64_t pixels = (uint64_t)picture->p.w * (uint64_t)picture->p.h;
    if (pixels > budget->limits.pixels || budget->pixels > budget->limits.cumulative || pixels > budget->limits.cumulative - budget->pixels) return -ENOMEM;
    uint64_t width = ((uint64_t)picture->p.w + 127u) & ~UINT64_C(127);
    uint64_t height = ((uint64_t)picture->p.h + 127u) & ~UINT64_C(127);
    uint64_t y_stride = width * (picture->p.bpc > 8 ? 2u : 1u);
    int chroma = picture->p.layout != DAV1D_PIXEL_LAYOUT_I400;
    int horizontal_shift = picture->p.layout != DAV1D_PIXEL_LAYOUT_I444;
    int vertical_shift = picture->p.layout == DAV1D_PIXEL_LAYOUT_I420;
    uint64_t uv_stride = chroma ? y_stride >> horizontal_shift : 0;
    uint64_t y_size = y_stride * height;
    uint64_t uv_size = uv_stride * (height >> vertical_shift);
    // 64-byte header と末尾 padding も同時使用量に含める。
    uint64_t bytes = y_size + 2u * uv_size + 2u * DAV1D_PICTURE_ALIGNMENT;
    if (bytes > SIZE_MAX || y_stride > PTRDIFF_MAX || uv_stride > PTRDIFF_MAX ||
        bytes > LIVE_BYTE_LIMIT || budget->live_bytes > LIVE_BYTE_LIMIT - bytes) return -ENOMEM;
#ifdef _WIN32
    uint8_t *block = (uint8_t *)_aligned_malloc((size_t)bytes, DAV1D_PICTURE_ALIGNMENT);
#else
    uint8_t *block = (uint8_t *)aligned_alloc(DAV1D_PICTURE_ALIGNMENT, (size_t)bytes);
#endif
    if (!block) return -ENOMEM;
    *((uint64_t *)block) = bytes;
    uint8_t *data = block + DAV1D_PICTURE_ALIGNMENT;
    picture->allocator_data = block;
    picture->data[0] = data;
    picture->data[1] = chroma ? data + (size_t)y_size : NULL;
    picture->data[2] = chroma ? data + (size_t)y_size + (size_t)uv_size : NULL;
    picture->stride[0] = (ptrdiff_t)y_stride;
    picture->stride[1] = (ptrdiff_t)uv_stride;
    budget->pixels += pixels; budget->live_bytes += bytes;
    if (budget->live_bytes > budget->peak_bytes) budget->peak_bytes = budget->live_bytes;
    return 0;
}
static void release_picture(Dav1dPicture *picture, void *cookie) {
    AllocationBudget *budget = (AllocationBudget *)cookie;
    uint8_t *block = (uint8_t *)picture->allocator_data;
    budget->live_bytes -= *((uint64_t *)block);
#ifdef _WIN32
    _aligned_free(block);
#else
    free(block);
#endif
}
void hologramConfigureDav1dBudget(Dav1dSettings *settings) {
    settings->allocator.cookie = &allocation_budget;
    settings->allocator.alloc_picture_callback = allocate_picture;
    settings->allocator.release_picture_callback = release_picture;
}

static int fail(const char *message) {
    fprintf(stderr, "AVIF validation failed: %s; codedAllocatedPixels=%" PRIu64 "; livePictureBytes=%" PRIu64 "\n",
            message, allocation_budget.pixels, allocation_budget.live_bytes);
    return 1;
}
static int append(Output *out, const char *format, ...) {
    va_list args; va_start(args, format);
    int n = vsnprintf(out->data + out->length, OUTPUT_LIMIT - 1024u - out->length, format, args);
    va_end(args);
    if (n < 0 || (size_t)n >= OUTPUT_LIMIT - 1024u - out->length) return 0;
    out->length += (size_t)n; return 1;
}
static int number(const char *text, uint64_t max, uint64_t *value) {
    if (!text[0]) return 0;
    for (const char *c = text; *c; ++c) if (*c < '0' || *c > '9') return 0;
    errno = 0; char *end; unsigned long long n = strtoull(text, &end, 10);
    if (errno || *end || !n || n > max) return 0;
    *value = (uint64_t)n; return 1;
}
#ifdef _WIN32
static int limit_validator_process(void) {
    // picture 以外の parser・grid 組立・metadata の commit も OS に制限させる。
    // KILL_ON_JOB_CLOSE は付けず、通常終了時の stdout flush を妨げない。
    HANDLE job = CreateJobObjectW(NULL, NULL);
    if (!job) return 0;
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits = {0};
    limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_PROCESS_MEMORY | JOB_OBJECT_LIMIT_JOB_MEMORY;
    limits.ProcessMemoryLimit = PROCESS_BYTE_LIMIT; limits.JobMemoryLimit = PROCESS_BYTE_LIMIT;
    if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, &limits, sizeof(limits)) ||
        !AssignProcessToJobObject(job, GetCurrentProcess())) { CloseHandle(job); return 0; }
    // OS が process 終了時に閉じる。限度は parser 開始前から最後まで維持する。
    process_memory_budget_enabled = 1;
    return 1;
}
// 親が所有する utility process に、画像要求を送る前に OS の commit 上限を設定する。
// job handle はこの supervisor だけが保持する。親の stdin pipe が閉じれば破棄する。
static int supervise(const char *pid_text, const char *bytes_text) {
    uint64_t pid, max_bytes;
    if (!number(pid_text, UINT32_MAX, &pid) || !number(bytes_text, SIZE_MAX, &max_bytes) || pid == GetCurrentProcessId()) return fail("invalid supervisor arguments");
    HANDLE pipe = GetStdHandle(STD_INPUT_HANDLE);
    if (pipe == NULL || pipe == INVALID_HANDLE_VALUE || GetFileType(pipe) != FILE_TYPE_PIPE) return fail("supervisor requires parent stdin pipe");
    HANDLE process = OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE | PROCESS_QUERY_INFORMATION | PROCESS_VM_READ | SYNCHRONIZE, FALSE, (DWORD)pid);
    if (!process) return fail("cannot open supervised process");
    PROCESS_MEMORY_COUNTERS_EX memory = {0}; memory.cb = sizeof(memory);
    if (!GetProcessMemoryInfo(process, (PROCESS_MEMORY_COUNTERS *)&memory, sizeof(memory)) || memory.PrivateUsage > (SIZE_T)max_bytes) {
        CloseHandle(process); return fail("supervised process exceeds startup budget");
    }
    HANDLE job = CreateJobObjectW(NULL, NULL);
    if (!job) { CloseHandle(process); return fail("cannot create memory job"); }
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits = {0};
    limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_PROCESS_MEMORY | JOB_OBJECT_LIMIT_JOB_MEMORY | JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    limits.ProcessMemoryLimit = (SIZE_T)max_bytes; limits.JobMemoryLimit = (SIZE_T)max_bytes;
    if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, &limits, sizeof(limits)) || !AssignProcessToJobObject(job, process)) {
        CloseHandle(job); CloseHandle(process); return fail("cannot attach supervised process to memory job");
    }
    if (!GetProcessMemoryInfo(process, (PROCESS_MEMORY_COUNTERS *)&memory, sizeof(memory)) || memory.PrivateUsage > (SIZE_T)max_bytes) {
        CloseHandle(job); CloseHandle(process); return fail("supervised process exceeds attached budget");
    }
    DWORD written = 0;
    if (!WriteFile(GetStdHandle(STD_OUTPUT_HANDLE), "READY\n", 6, &written, NULL) || written != 6) {
        CloseHandle(job); CloseHandle(process); return fail("supervisor readiness output");
    }
    int status = 0;
    for (;;) {
        DWORD waited = WaitForSingleObject(process, 100);
        if (waited == WAIT_OBJECT_0) break;
        if (waited != WAIT_TIMEOUT) { status = fail("supervised process wait"); break; }
        DWORD available = 0;
        if (!PeekNamedPipe(pipe, NULL, 0, NULL, &available, NULL)) {
            if (GetLastError() != ERROR_BROKEN_PIPE) status = fail("supervisor parent pipe");
            break;
        }
        // この pipe の意味は親の lifetime だけ。画像や命令は受け取らない。
        if (available != 0) { status = fail("unexpected supervisor input"); break; }
    }
    CloseHandle(job); CloseHandle(process); return status;
}
// 完成済みの隣接 tmp を非置換で公開する。MoveFileW は FAT / NTFS の双方で
// 既存名を置換せず、媒体の途中状態を最終名へ公開しない。
static int read_pipe_exact(HANDLE input, void *buffer, DWORD length) {
    DWORD offset = 0;
    while (offset < length) {
        DWORD got = 0;
        if (!ReadFile(input, (char *)buffer + offset, length - offset, &got, NULL) || !got) return 0;
        offset += got;
    }
    return 1;
}
static wchar_t *publish_path(const char *text, DWORD size) {
    if (memchr(text, 0, size)) return NULL;
    int length = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, text, (int)size, NULL, 0);
    if (length < 3 || length > 32760) return NULL;
    wchar_t *path = calloc((size_t)length + 9, sizeof(wchar_t));
    if (!path) return NULL;
    // 長い絶対パスも Unicode Win32 path として扱う。
    if (size >= 4 && memcmp(text, "\\\\?\\", 4) == 0) {
        if (!MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, text, (int)size, path, length)) { free(path); return NULL; }
    } else if (size >= 2 && text[0] == '\\' && text[1] == '\\') {
        memcpy(path, L"\\\\?\\UNC\\", 8 * sizeof(wchar_t));
        if (!MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, text + 2, (int)size - 2, path + 8, length - 2)) { free(path); return NULL; }
    } else {
        if (text[1] != ':' || text[2] != '\\') { free(path); return NULL; }
        memcpy(path, L"\\\\?\\", 4 * sizeof(wchar_t));
        if (!MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, text, (int)size, path + 4, length)) { free(path); return NULL; }
    }
    return path;
}
static int publish_server(void) {
    HANDLE input = GetStdHandle(STD_INPUT_HANDLE), output = GetStdHandle(STD_OUTPUT_HANDLE);
    for (;;) {
        DWORD lengths[2];
        if (!read_pipe_exact(input, lengths, sizeof(lengths))) return 0;
        if (!lengths[0] || !lengths[1] || lengths[0] > 131072 || lengths[1] > 131072) return fail("invalid publish request size");
        char *source_text = malloc(lengths[0]), *target_text = malloc(lengths[1]);
        if (!source_text || !target_text) { free(source_text); free(target_text); return fail("publish allocation"); }
        int read = read_pipe_exact(input, source_text, lengths[0]) && read_pipe_exact(input, target_text, lengths[1]);
        wchar_t *source = read ? publish_path(source_text, lengths[0]) : NULL;
        wchar_t *target = read ? publish_path(target_text, lengths[1]) : NULL;
        free(source_text); free(target_text);
        if (!source || !target) { free(source); free(target); return fail("invalid publish path"); }
        DWORD result = MoveFileW(source, target) ? 0 : GetLastError(), written = 0;
        free(source); free(target);
        if (!WriteFile(output, &result, sizeof(result), &written, NULL) || written != sizeof(result)) return fail("publish response");
    }
}
#endif
static FILE *open_input(const char *path) {
#ifdef _WIN32
    int count = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, path, -1, NULL, 0);
    if (!count) return NULL;
    wchar_t *wide = (wchar_t *)malloc((size_t)count * sizeof(wchar_t));
    if (!wide) return NULL;
    if (!MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, path, -1, wide, count)) { free(wide); return NULL; }
    FILE *file = _wfopen(wide, L"rb"); free(wide); return file;
#else
    return fopen(path, "rb");
#endif
}
static int image_budget(const avifImage *image, const Limits *limits, uint64_t *total) {
    if (!image || !image->width || !image->height || image->width > limits->dimension || image->height > limits->dimension) return 0;
    uint64_t pixels = (uint64_t)image->width * image->height;
    if (pixels > limits->pixels || *total > limits->cumulative || pixels > limits->cumulative - *total) return 0;
    *total += pixels; return 1;
}
static int display_dimensions(const avifImage *image, Summary *summary) {
    summary->display_width = image->width; summary->display_height = image->height;
    // Electron 44 / Chromium 152 の実測では clap は適用されず、irot は適用される。
    // 規格の表示寸法とは別に保持し、ブラウザ上の canvas 検証で混同しない。
    summary->browser_width = image->width; summary->browser_height = image->height;
    if (image->transformFlags & AVIF_TRANSFORM_CLAP) {
        avifCropRect crop; avifDiagnostics diagnostics = {{0}};
        if (!avifCropRectFromCleanApertureBox(&crop, &image->clap, image->width, image->height, &diagnostics)) return 0;
        summary->display_width = crop.width; summary->display_height = crop.height;
    }
    if ((image->transformFlags & AVIF_TRANSFORM_IROT) && (image->irot.angle & 1u)) {
        uint32_t width = summary->display_width;
        summary->display_width = summary->display_height; summary->display_height = width;
        width = summary->browser_width;
        summary->browser_width = summary->browser_height; summary->browser_height = width;
    }
    return 1;
}
static avifDecoder *decoder(const uint8_t *bytes, size_t size, const Limits *limits) {
    avifDecoder *d = avifDecoderCreate(); if (!d) return NULL;
    d->codecChoice = AVIF_CODEC_CHOICE_DAV1D; d->maxThreads = 1;
    d->imageSizeLimit = limits->pixels; d->imageDimensionLimit = limits->dimension; d->imageCountLimit = limits->frames;
    d->allowProgressive = AVIF_TRUE; d->allowIncremental = AVIF_FALSE;
    d->imageContentToDecode = AVIF_IMAGE_CONTENT_ALL | AVIF_IMAGE_CONTENT_SAMPLE_TRANSFORMS;
    d->ignoreExif = AVIF_TRUE; d->ignoreXMP = AVIF_TRUE;
    if (avifDecoderSetIOMemory(d, bytes, size) != AVIF_RESULT_OK) { avifDecoderDestroy(d); return NULL; }
    return d;
}
// 0: 有効、1: 拒否、2: sequence のみで primary が存在しない。
static int validate_source(const uint8_t *bytes, size_t size, const Limits *limits,
                           avifDecoderSource source, int tracks_present,
                           uint64_t *total, Output *out, Summary *summary) {
    avifDecoder *d = decoder(bytes, size, limits); if (!d) return 1;
    avifResult result = avifDecoderSetSource(d, source);
    if (result == AVIF_RESULT_OK) result = avifDecoderParse(d);
    if (result != AVIF_RESULT_OK) {
        // 公開 API に primary の存在フラグがない。公式の「未指定」だけを許容し、
        // 指定された item の欠落・破損は同じ MISSING_IMAGE_ITEM でも拒否する。
        int absent = tracks_present && source == AVIF_DECODER_SOURCE_PRIMARY_ITEM &&
                     result == AVIF_RESULT_MISSING_IMAGE_ITEM && strcmp(d->diag.error, "Primary item not specified") == 0;
        avifDecoderDestroy(d); return absent ? 2 : 1;
    }
    if (d->imageCount < 1 || (uint32_t)d->imageCount > limits->frames) { avifDecoderDestroy(d); return 1; }
    summary->frames = d->imageCount; summary->repetition = d->repetitionCount;
    summary->progressive = d->progressiveState == AVIF_PROGRESSIVE_STATE_ACTIVE;
    summary->timescale = d->timescale; summary->duration = d->durationInTimescales;
    if (!append(out, "{\"source\":\"%s\",\"timing\":[", source == AVIF_DECODER_SOURCE_TRACKS ? "tracks" : "primary")) { avifDecoderDestroy(d); return 1; }
    for (int i = 0; i < d->imageCount; ++i) {
        // 次のフレームの復号前に残予算を確認する。coded frame のサイズ制限は
        // libavif が dav1d の frame_size_limit に渡す imageSizeLimit で適用する。
        uint64_t remaining = limits->cumulative - *total;
        if (!remaining || (uint64_t)d->image->width * d->image->height > remaining) { avifDecoderDestroy(d); return 1; }
        result = avifDecoderNextImage(d);
        if (result != AVIF_RESULT_OK || !image_budget(d->image, limits, total)) { avifDecoderDestroy(d); return 1; }
        if (d->image->gainMap && d->image->gainMap->image) {
            if (!image_budget(d->image->gainMap->image, limits, total)) { avifDecoderDestroy(d); return 1; }
            summary->gainMap = AVIF_TRUE;
        }
        summary->width = d->image->width; summary->height = d->image->height; summary->depth = d->image->depth;
        if (!display_dimensions(d->image, summary)) { avifDecoderDestroy(d); return 1; }
        summary->alpha = d->alphaPresent; summary->primaries = d->image->colorPrimaries;
        summary->transfer = d->image->transferCharacteristics; summary->matrix = d->image->matrixCoefficients;
        if (!append(out, "%s{\"timescale\":\"%" PRIu64 "\",\"durationInTimescales\":\"%" PRIu64 "\",\"ptsInTimescales\":\"%" PRIu64 "\"}",
                    i ? "," : "", d->imageTiming.timescale, d->imageTiming.durationInTimescales, d->imageTiming.ptsInTimescales)) { avifDecoderDestroy(d); return 1; }
    }
    if (avifDecoderNextImage(d) != AVIF_RESULT_NO_IMAGES_REMAINING) { avifDecoderDestroy(d); return 1; }
    int ok = append(out, "],\"width\":%u,\"height\":%u,\"displayWidth\":%u,\"displayHeight\":%u,\"browserWidth\":%u,\"browserHeight\":%u,\"depth\":%u,\"frames\":%d,\"alpha\":%s,\"progressive\":%s,\"gainMap\":%s}",
                    summary->width, summary->height, summary->display_width, summary->display_height,
                    summary->browser_width, summary->browser_height, summary->depth, summary->frames,
                    summary->alpha ? "true" : "false", summary->progressive ? "true" : "false", summary->gainMap ? "true" : "false");
    avifDecoderDestroy(d); return ok ? 0 : 1;
}
static int validate_main(int argc, char **argv) {
    if (argc == 2 && strcmp(argv[1], "--publish-server") == 0) {
#ifdef _WIN32
        return publish_server();
#else
        return fail("file publication helper is supported only on Windows");
#endif
    }
    if (argc == 4 && strcmp(argv[1], "--supervise") == 0) {
#ifdef _WIN32
        return supervise(argv[2], argv[3]);
#else
        return fail("memory job supervisor is supported only on Windows");
#endif
    }
    if (argc == 2 && strcmp(argv[1], "--version") == 0) {
        char codecs[256]; avifCodecVersions(codecs);
        printf("libavif %s; %s\n", avifVersion(), codecs);
        return 0;
    }
    if (argc != 6) return fail("expected input path and four positive budgets");
    uint64_t values[4];
    for (int i = 0; i < 4; ++i) if (!number(argv[i + 2], i == 3 ? UINT64_MAX : UINT32_MAX, &values[i])) return fail("invalid budget");
    if (values[0] > AVIF_DEFAULT_IMAGE_SIZE_LIMIT || values[2] > 10000) return fail("budget exceeds supported maximum");
    Limits limits = { (uint32_t)values[0], (uint32_t)values[1], (uint32_t)values[2], values[3] };
    allocation_budget.limits = limits;
#ifdef _WIN32
    if (!limit_validator_process()) return fail("cannot enforce decoder process memory budget");
#endif
    FILE *input = open_input(argv[1]); if (!input) return fail("cannot open input");
    uint8_t *bytes = (uint8_t *)malloc(INPUT_LIMIT + 1u);
    if (!bytes) { fclose(input); return fail("input allocation"); }
    size_t size = fread(bytes, 1, INPUT_LIMIT + 1u, input);
    int io_error = ferror(input); fclose(input);
    if (io_error || !size || size > INPUT_LIMIT) { free(bytes); return fail("input size or IO"); }
    avifDecoder *probe = decoder(bytes, size, &limits);
    if (!probe) { free(bytes); return fail("decoder allocation"); }
    avifResult result = avifDecoderParse(probe);
    if (result != AVIF_RESULT_OK) { avifDecoderDestroy(probe); free(bytes); return fail("container"); }
    int tracks = probe->imageSequenceTrackPresent;
    avifDecoderDestroy(probe);
    Output out = { (char *)malloc(OUTPUT_LIMIT), 0 };
    if (!out.data) { free(bytes); return fail("output allocation"); }
    Summary primary = {0}, sequence = {0}; uint64_t total = 0;
    int primary_result = validate_source(bytes, size, &limits, AVIF_DECODER_SOURCE_PRIMARY_ITEM, tracks, &total, &out, &primary);
    if (primary_result == 1) { free(out.data); free(bytes); return fail("primary image"); }
    if (tracks) {
        if (primary_result == 0 && !append(&out, ",")) { free(out.data); free(bytes); return fail("output budget"); }
        if (validate_source(bytes, size, &limits, AVIF_DECODER_SOURCE_TRACKS, 1, &total, &out, &sequence)) { free(out.data); free(bytes); return fail("image sequence"); }
    }
    free(bytes);
    if (allocation_budget.live_bytes != 0) { free(out.data); return fail("picture release"); }
    Summary *s = tracks ? &sequence : &primary;
    printf("{\"version\":1,\"decoder\":\"libavif/dav1d\",\"width\":%u,\"height\":%u,\"browserWidth\":%u,\"browserHeight\":%u,\"frames\":%d,\"animated\":%s,\"depth\":%u,\"alpha\":%s,\"primaries\":%u,\"transfer\":%u,\"matrix\":%u,\"repetitionCount\":%d,\"timescale\":\"%" PRIu64 "\",\"durationInTimescales\":\"%" PRIu64 "\",\"cumulativePixels\":\"%" PRIu64 "\",\"outputPixels\":\"%" PRIu64 "\",\"limits\":{\"pixels\":%u,\"dimension\":%u,\"frames\":%u,\"cumulativePixels\":\"%" PRIu64 "\",\"liveBytes\":%u,\"processPrivateCommitBytes\":%u},\"peakLiveBytes\":\"%" PRIu64 "\",\"liveBytesAfterDecode\":0,\"allocatorBudget\":true,\"processMemoryBudget\":%s,\"sources\":[%s]}\n",
           s->display_width, s->display_height, s->browser_width, s->browser_height,
           s->frames, tracks && s->frames > 1 ? "true" : "false", s->depth,
           s->alpha ? "true" : "false", s->primaries, s->transfer, s->matrix, s->repetition,
           s->timescale, s->duration, allocation_budget.pixels, total, limits.pixels, limits.dimension,
           limits.frames, limits.cumulative, LIVE_BYTE_LIMIT, process_memory_budget_enabled ? PROCESS_BYTE_LIMIT : 0u,
           allocation_budget.peak_bytes, process_memory_budget_enabled ? "true" : "false", out.data);
    free(out.data); return ferror(stdout) ? 1 : 0;
}
#ifdef _WIN32
int wmain(int argc, wchar_t **wide_argv) {
    char **argv = (char **)calloc((size_t)argc, sizeof(char *));
    if (!argv) return fail("argument allocation");
    int status = 1;
    for (int i = 0; i < argc; ++i) {
        int size = WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, wide_argv[i], -1, NULL, 0, NULL, NULL);
        if (!size) goto cleanup;
        argv[i] = (char *)malloc((size_t)size);
        if (!argv[i] || !WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, wide_argv[i], -1, argv[i], size, NULL, NULL)) goto cleanup;
    }
    status = validate_main(argc, argv);
cleanup:
    for (int i = 0; i < argc; ++i) free(argv[i]);
    free(argv); return status;
}
#else
int main(int argc, char **argv) { return validate_main(argc, argv); }
#endif
