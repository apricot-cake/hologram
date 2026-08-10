'use strict';

// コードが所有するモデルレジストリ（#832、親 #98）——どのモデルファイルが
// 存在し、どの Hugging Face リビジョンに固定されていて、各ファイルがどの
// SHA-256 にハッシュされるべきかを名指しする唯一の場所。純粋なデータと純粋な
// ヘルパーのみ: ここにはネットワークにもファイルシステムにも触れるものが無い。
// lib-model-fetch.ts と lib-model-manager.ts は、このモジュールが渡す
// エントリに対して動作する。
//
// rev は Hugging Face の「コミットハッシュ」であって、ブランチやタグでは
// 絶対にない（#832 が却下した「main を追う」設計——タグは明日には別のコミットを
// 指しうるし、固定するのはまさに、同じアプリのビルドが常に同じバイト列を
// 要求するようにするため）。sha256/bytes は執筆時に、固定した rev から一度だけ
// 計測してここに焼き込む——実行時に Hugging Face 自身のメタデータから再導出
// したりはしない。それをすると、検証が本来検出すべきずれと同じ値に対して
// 照合することになってしまう。

import path from 'node:path';

export interface ModelRegistryFile {
  /** Hugging Face 上でもディスク上でも、モデルの root からの相対パス。 */
  path: string;
  sha256: string;
  bytes: number;
}

/**
 * そのモデルが「何のため」かを、レンダラーが翻訳するキーとして表す
 * （#50 §6-4）。リポジトリ id とライセンスだけでは、378MB のダウンロードが
 * 何をもたらすか読み手には分からず、読めないオプトインはオプトインとして
 * あまり意味を成さない。
 */
export type ModelPurpose = 'tag-suggestions' | 'tag-matching';

export interface ModelRegistryEntry {
  /** Hugging Face のリポジトリ id。例: "Xenova/all-MiniLM-L6-v2"。 */
  id: string;
  /** コミットハッシュ——ブランチやタグでは絶対にない。 */
  rev: string;
  purpose: ModelPurpose;
  files: ModelRegistryFile[];
  /** 設定の AI Features 節と THIRD-PARTY-NOTICES.md に表示される。 */
  licenseNote: string;
}

/**
 * レジストリ本体。実際に出荷するモデル1つにつきエントリ1つ。機能の Issue
 * （#48/#49/#50/#51）が必要になった時に自分のエントリを追加する。
 */
export const MODEL_REGISTRY: ModelRegistryEntry[] = [
  {
    // #831 のスモークモデル——最初の実利用者は #165（意味ベースのタグ照合）。
    // scripts/test-ml-runtime.cts は同じ id/rev/files を独立に固定している
    // （CJS/.cts のハーネスからこの ESM モジュールを import できないため）。
    // scripts/model-registry.test.ts が、両者がずれていないかを突き合わせる。
    id: 'Xenova/all-MiniLM-L6-v2',
    rev: '751bff37182d3f1213fa05d7196b954e230abad9',
    purpose: 'tag-matching',
    files: [
      { path: 'config.json', sha256: '7135149f7cffa1a573466c6e4d8423ed73b62fd2332c575bf738a0d033f70df7', bytes: 650 },
      { path: 'tokenizer.json', sha256: 'da0e79933b9ed51798a3ae27893d3c5fa4a201126cef75586296df9b4d2c62a0', bytes: 711661 },
      { path: 'tokenizer_config.json', sha256: '9261e7d79b44c8195c1cada2b453e55b00aeb81e907a6664974b4d7776172ab3', bytes: 366 },
      { path: 'onnx/model_quantized.onnx', sha256: 'afdb6f1a0e45b715d0bb9b11772f032c399babd23bfc31fed1c170afc848bdb1', bytes: 22972370 },
    ],
    licenseNote: 'Apache License 2.0 - sentence-transformers/all-MiniLM-L6-v2 (ONNX port: Xenova/all-MiniLM-L6-v2)',
  },
  {
    // #50 のタグ付け器。Hugging Face の transformers モデルでは「ない」——
    // timm/JAX のエクスポートで、だからこそ lib-ai-tags.ts は入力を手で
    // 成形し、ml-worker.ts には素のセッション経路が生えている（ADR 0026 に
    // 記録された例外）。
    //
    // fp32 のみ: 上流のリポジトリは量子化ビルドを一切出荷していない（この rev の
    // ファイル一覧で確認済み）し、サードパーティの q8 は重みとその作者の間に
    // もう1段のホップを挟むことになる。378MB は許容範囲。ここには何もバンドル
    // されておらず、オプトイン後にのみ取得されるため。
    //
    // selected_tags.csv は「モデルファイル」であって、出荷するデータファイルでは
    // ない: ラベルの順序はこの rev のグラフの一部であり、食い違ったコピーは
    // すべての出力を黙って付け替えてしまう。重みと一緒に固定しハッシュ化する
    // ことが、両者がずれるのを防いでいる。
    id: 'SmilingWolf/wd-vit-tagger-v3',
    rev: '7f6b584d0bd3f55c4531f14ba3d4761b2bccdc0f',
    purpose: 'tag-suggestions',
    files: [
      { path: 'model.onnx', sha256: '35f23693620b668f4d53fd3c62bf65e40af739bc52c7eb0fbc49258b58d065b6', bytes: 378536310 },
      { path: 'selected_tags.csv', sha256: '298633d94d0031d2081c0893f29c82eab7f0df00b08483ba8f29d1e979441217', bytes: 308468 },
    ],
    licenseNote: 'Apache License 2.0 - SmilingWolf/wd-vit-tagger-v3 (trained on Danbooru images)',
  },
];

/** Hugging Face のリポジトリ id で1件のエントリを探す。 */
export function findModelEntry(id: string, registry: ModelRegistryEntry[] = MODEL_REGISTRY): ModelRegistryEntry | undefined {
  return registry.find((e) => e.id === id);
}

/**
 * modelsRoot() の下で、あるエントリのファイルが住む場所: "<org>/<name>@<rev>"。
 * Hugging Face 自身の org/name の分け方に合わせることで、配置がその出所の
 * すぐ隣で読みやすいままになる。
 */
export function modelDirFor(entry: Pick<ModelRegistryEntry, 'id' | 'rev'>, root: string): string {
  const segments = entry.id.split('/');
  const name = segments.pop();
  return path.join(root, ...segments, `${name}@${entry.rev}`);
}

/** そのエントリの固定 rev における1ファイルの、Hugging Face の「resolve」URL。 */
export function modelFileUrl(entry: Pick<ModelRegistryEntry, 'id' | 'rev'>, file: Pick<ModelRegistryFile, 'path'>): string {
  return `https://huggingface.co/${entry.id}/resolve/${entry.rev}/${file.path}`;
}
