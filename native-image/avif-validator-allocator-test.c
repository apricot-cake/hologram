// 実製品と同じ allocator を直接呼び、codec が要求する memory layout を検証する。
#define wmain avif_validator_wmain
#define main avif_validator_main
#include "avif-validator.c"
#undef main
#undef wmain

#define CHECK(condition) do { if (!(condition)) { fprintf(stderr, "allocator check failed at line %d\n", __LINE__); return 1; } } while (0)

int main(void) {
    const int depths[] = {8, 10, 12};
    const int sizes[][2] = {{1, 1}, {127, 129}, {129, 127}, {192, 257}};
    unsigned int passed = 0;
    for (unsigned int depth = 0; depth < 3; ++depth) {
        for (int layout = DAV1D_PIXEL_LAYOUT_I400; layout <= DAV1D_PIXEL_LAYOUT_I444; ++layout) {
            for (unsigned int size = 0; size < 4; ++size) {
                AllocationBudget budget = {{40000000, 32768, 1000, 1000000000}, 0, 0, 0};
                Dav1dPicture picture = {0};
                picture.p.w = sizes[size][0]; picture.p.h = sizes[size][1];
                picture.p.bpc = depths[depth]; picture.p.layout = (enum Dav1dPixelLayout)layout;
                CHECK(allocate_picture(&picture, &budget) == 0);
                CHECK(budget.pixels == (uint64_t)picture.p.w * (uint64_t)picture.p.h);
                CHECK(budget.live_bytes > 0 && budget.live_bytes <= LIVE_BYTE_LIMIT);
                CHECK((uintptr_t)picture.data[0] % DAV1D_PICTURE_ALIGNMENT == 0);
                CHECK(picture.stride[0] % DAV1D_PICTURE_ALIGNMENT == 0);
                uint64_t height = ((uint64_t)picture.p.h + 127u) & ~UINT64_C(127);
                memset(picture.data[0], 0xa5, (size_t)picture.stride[0] * (size_t)height);
                if (layout == DAV1D_PIXEL_LAYOUT_I400) {
                    CHECK(!picture.data[1] && !picture.data[2] && picture.stride[1] == 0);
                } else {
                    CHECK((uintptr_t)picture.data[1] % DAV1D_PICTURE_ALIGNMENT == 0);
                    CHECK((uintptr_t)picture.data[2] % DAV1D_PICTURE_ALIGNMENT == 0);
                    CHECK(picture.stride[1] % DAV1D_PICTURE_ALIGNMENT == 0);
                    uint64_t uv_height = height >> (layout == DAV1D_PIXEL_LAYOUT_I420);
                    memset(picture.data[1], 0x5a, (size_t)picture.stride[1] * (size_t)uv_height);
                    memset(picture.data[2], 0x5a, (size_t)picture.stride[1] * (size_t)uv_height);
                }
                release_picture(&picture, &budget);
                CHECK(budget.live_bytes == 0);
                ++passed;
            }
        }
    }
    AllocationBudget budget = {{256, 32768, 1000, 1000000000}, 0, 0, 0};
    Dav1dPicture picture = {0}; picture.p.w = 17; picture.p.h = 16; picture.p.bpc = 8; picture.p.layout = DAV1D_PIXEL_LAYOUT_I420;
    CHECK(allocate_picture(&picture, &budget) < 0); CHECK(budget.pixels == 0 && budget.live_bytes == 0); ++passed;
    budget.limits.pixels = 40000000; budget.limits.dimension = 8; picture.p.w = 9; picture.p.h = 1;
    CHECK(allocate_picture(&picture, &budget) < 0); ++passed;
    budget.limits.dimension = 32768; budget.limits.cumulative = 1000; budget.pixels = 900; picture.p.w = picture.p.h = 16;
    CHECK(allocate_picture(&picture, &budget) < 0); CHECK(budget.pixels == 900); ++passed;
    budget.pixels = 0; budget.limits.cumulative = 1000000000; budget.live_bytes = LIVE_BYTE_LIMIT - 32u; picture.p.w = picture.p.h = 1;
    CHECK(allocate_picture(&picture, &budget) < 0); CHECK(budget.live_bytes == LIVE_BYTE_LIMIT - 32u); ++passed;
    budget.live_bytes = 0; picture.p.bpc = 16; CHECK(allocate_picture(&picture, &budget) < 0); ++passed;
    picture.p.bpc = 8; picture.p.w = 0; CHECK(allocate_picture(&picture, &budget) < 0); ++passed;
    picture.p.w = INT32_MAX; picture.p.h = INT32_MAX; budget.limits.dimension = UINT32_MAX;
    CHECK(allocate_picture(&picture, &budget) < 0); CHECK(budget.live_bytes == 0); ++passed;
    avifImage image = {0}; image.width = 12; image.height = 34; Summary summary = {0};
    avifCropRect rect = {4, 6, 8, 10}; avifDiagnostics diagnostics = {{0}};
    CHECK(avifCleanApertureBoxFromCropRect(&image.clap, &rect, image.width, image.height, &diagnostics));
    image.transformFlags = AVIF_TRANSFORM_CLAP | AVIF_TRANSFORM_IROT | AVIF_TRANSFORM_IMIR;
    image.irot.angle = 1; image.imir.axis = 1;
    CHECK(display_dimensions(&image, &summary)); CHECK(summary.display_width == 10 && summary.display_height == 8); ++passed;
    CHECK(image.width == 12 && image.height == 34); CHECK(summary.browser_width == 34 && summary.browser_height == 12); ++passed;
    image.transformFlags = AVIF_TRANSFORM_IROT; image.irot.angle = 2;
    CHECK(display_dimensions(&image, &summary)); CHECK(summary.display_width == 12 && summary.display_height == 34); ++passed;
    CHECK(summary.browser_width == 12 && summary.browser_height == 34); ++passed;
    image.irot.angle = 3;
    CHECK(display_dimensions(&image, &summary)); CHECK(summary.display_width == 34 && summary.display_height == 12); ++passed;
    CHECK(summary.browser_width == 34 && summary.browser_height == 12); ++passed;
    printf("allocator checks passed: %u\n", passed);
    return 0;
}
