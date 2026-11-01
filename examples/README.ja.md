# 例

[English](README.md) | **日本語**

どの図も、横にある YAML ファイルから `yaml2drawio build` で生成し、draw.io で PNG にしたものです。
画像をクリックすると元の大きさで開きます。`.drawio` ファイルを draw.io で開けば、そのまま編集できます。

## クイックスタート

境界に Internet Gateway を置いた VPC に、ロードバランサーと、API とデータベースを横に並べた行があります。

<a href="../docs/images/quick-start.png"><img src="../docs/images/quick-start.png" alt="IGW、ALB、API、Aurora を置いた VPC" width="240"></a>

[quick-start.yaml](quick-start.yaml) · [quick-start.drawio](../docs/images/quick-start.drawio)

## Web アプリケーション

リージョンにアベイラビリティゾーンが 2 つあり、それぞれにパブリック・アプリ・データのサブネットがあります。線はサブネットを縦にまっすぐ通ります。

<a href="../docs/images/web-app.png"><img src="../docs/images/web-app.png" alt="AWS の 2 つのアベイラビリティゾーンにまたがる Web アプリケーション" width="360"></a>

[web-app.yaml](web-app.yaml) · [web-app.drawio](../docs/images/web-app.drawio)

## EC サイト

東京のメインリージョンと大阪の DR リージョンの構成です。VPC の外のサービス、長さの違う行をそろえる空きスロット、線のラベルも使っています。

<a href="../docs/images/ecommerce.png"><img src="../docs/images/ecommerce.png" alt="AWS の 2 つのリージョンにまたがる EC サイト"></a>

[ecommerce.yaml](ecommerce.yaml) · [ecommerce.drawio](../docs/images/ecommerce.drawio)

## 複数のクラウド

Google Cloud、Azure、GKE クラスタを 1 つの図に描いています。クラウドごとに draw.io のレイヤーを分けているので、クラウドごとに表示・非表示を切り替えられます。

<a href="../docs/images/multi-cloud.png"><img src="../docs/images/multi-cloud.png" alt="Google Cloud、Azure、GKE クラスタ" width="720"></a>

[multi-cloud.yaml](multi-cloud.yaml) · [multi-cloud.drawio](../docs/images/multi-cloud.drawio)

## 各クラウドのグループ

Google Cloud・Azure・Kubernetes のグループ（プロジェクト、サブスクリプション、VNet、名前空間、ノードなど）を、各社の図と同じ入れ子にしています。

<a href="../docs/images/provider-groups.png"><img src="../docs/images/provider-groups.png" alt="Google Cloud・Azure・Kubernetes のグループ"></a>

[provider-groups.yaml](provider-groups.yaml) · [provider-groups.drawio](../docs/images/provider-groups.drawio)
