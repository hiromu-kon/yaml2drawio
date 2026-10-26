# yaml2drawio

[English](README.md) | **日本語**

インフラ構成図（まずは AWS）を YAML で書くと、配置を計算した [draw.io](https://www.drawio.com/) のファイルを出力します。
書くのは構造（何の中に何があるか、どの順に並べるか、何と何がつながっているか）だけで、座標は yaml2drawio が計算します。

> 状況: 開発中です。今あるのはアイコン辞書と入力の書き方の定義だけです。

## 書き方の例（予定）

```yaml
direction: vertical
nodes:
  - group: aws.vpc
    label: Production VPC
    direction: vertical
    border:
      n: { id: igw, icon: aws.igw, label: IGW }
    children:
      - { id: alb, icon: aws.alb, label: ALB }
      - row:
          - { id: api, icon: aws.ecs, label: API }
          - { id: db, icon: aws.aurora, label: Aurora }
links:
  - [igw.s, alb.n]
  - [alb.s, api.n]
  - { from: api.e, to: db.w, style: dashed }
```

## 開発

[mise](https://mise.jdx.dev/) が必要です（Node と pnpm のバージョンは `mise.toml` で固定しています）。

```sh
pnpm install
pnpm check              # 型チェック・リント・テスト・フォーマットの確認
pnpm dev icons redis    # アイコン辞書を検索する
pnpm catalog            # draw.io のソースから catalog/aws.json を作り直す
```

アイコンは draw.io のサイドバー定義（[jgraph/drawio](https://github.com/jgraph/drawio)、Apache-2.0）から抜き出しています。
yaml2drawio は draw.io や JGraph とは関係のない非公式のツールです。

## ライセンス

MIT
