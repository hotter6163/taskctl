# taskctl

AI-Powered Task Management CLI using Mastra framework.

Git worktree を活用して並行開発を行い、AI が Google の Small CL プラクティスに基づいてタスクを分割・計画します。

## 特徴

- **Small CL 分割**: AI が大きなタスクを ~100行程度の小さな変更単位に分割
- **Worktree プール**: 複数の worktree を事前作成し、並行開発を実現
- **依存関係グラフ**: タスク間の依存関係を DAG として管理
- **Human-in-the-loop**: AI が提案し、人間が確認・修正するワークフロー
- **GitHub 統合**: gh CLI を使用した PR 管理

## 必要条件

- Node.js 20+
- Git
- GitHub CLI (`gh`) - PR 機能を使う場合
- Anthropic API Key - AI 機能を使う場合

## インストール

```bash
# リポジトリをクローン
git clone https://github.com/your-org/taskctl.git
cd taskctl

# 依存関係をインストール (bun 推奨)
bun install

# ビルド
bun run build

# グローバルにリンク (オプション)
npm link
```

## セットアップ

### 環境変数

```bash
# AI 機能を使用する場合は必須
export ANTHROPIC_API_KEY=your-api-key

# オプション: データベースパスの変更
export TASKCTL_DB_PATH=/path/to/taskctl.db

# オプション: ログレベル
export TASKCTL_LOG_LEVEL=debug  # debug, info, warn, error
```

### GitHub CLI 認証

PR 機能を使用する場合:

```bash
# gh CLI をインストール
brew install gh

# 認証
gh auth login
```

## 基本的な使い方

### 1. プロジェクトの初期化

```bash
# 既存のリポジトリを初期化
cd your-project
taskctl init

# リモートリポジトリをクローンして初期化
taskctl init --clone https://github.com/org/repo.git

# オプション指定
taskctl init --worktrees 5 --main-branch main --name my-project
```

### 2. プランの作成

```bash
# 新しいプランを作成
taskctl plan new "Add user authentication"

# プラン一覧を表示
taskctl plan list
```

### 3. AI によるタスク生成

```bash
# プロンプトからタスクを自動生成
taskctl plan ai generate "
  Implement user authentication with:
  - User model with email/password
  - JWT-based authentication
  - Login/Register/Logout endpoints
  - Auth middleware for protected routes
"

# 既存のプランにタスクを追加
taskctl plan ai generate "Add password reset feature" --plan-id <plan-id>

# コンテキストファイルを指定
taskctl plan ai generate "Refactor auth module" --context src/auth.ts src/models/user.ts
```

### 4. プランの確認と開始

```bash
# プランの詳細を表示
taskctl plan show <plan-id>

# 依存グラフを表示
taskctl plan graph <plan-id>

# Mermaid 形式で出力
taskctl plan graph <plan-id> --format mermaid

# プランを開始
taskctl plan start <plan-id>
```

### 5. タスクの実行

```bash
# 並行実行 (ready なタスクを worktree に割り当て)
taskctl exec parallel

# 最大同時実行数を指定
taskctl exec parallel --max-concurrent 3

# 実行計画のみ表示 (dry-run)
taskctl exec parallel --dry-run

# 単一タスクを実行
taskctl exec task <task-id>

# 実行状況を確認
taskctl exec status
```

### 6. 実装作業

タスクが worktree に割り当てられたら:

```bash
# worktree に移動
cd /path/to/project-worktrees/project0

# 実装作業を行う
# ...

# コミット
git add .
git commit -m "feat: add user model"
```

### 7. PR の作成と管理

```bash
# PR を作成
taskctl pr create <task-id>

# ドラフト PR として作成
taskctl pr create <task-id> --draft

# PR 一覧を表示
taskctl pr list

# GitHub から PR ステータスを同期
taskctl pr sync

# PR をマージ
taskctl pr merge <task-id>

# squash マージ
taskctl pr merge <task-id> --squash
```

### 8. ステータス確認

```bash
# 全体ステータスを表示
taskctl status

# JSON 形式で出力
taskctl status --json
```

## コマンドリファレンス

### グローバルオプション

| オプション | 説明 |
|-----------|------|
| `-v, --verbose` | 詳細ログ出力 |
| `-q, --quiet` | 最小限の出力 |
| `-h, --help` | ヘルプ表示 |
| `-V, --version` | バージョン表示 |

### init

```bash
taskctl init [options]
```

| オプション | 説明 | デフォルト |
|-----------|------|-----------|
| `-c, --clone <url>` | クローンする URL | - |
| `-w, --worktrees <n>` | Worktree 数 | 10 |
| `-b, --main-branch <branch>` | メインブランチ名 | main |
| `-n, --name <name>` | プロジェクト名 | ディレクトリ名 |

### project

```bash
taskctl project list              # プロジェクト一覧
taskctl project show [id]         # プロジェクト詳細
taskctl project current           # 現在のプロジェクト ID
taskctl project config [options]  # 設定変更
taskctl project remove [id]       # プロジェクト削除
```

### plan

```bash
taskctl plan new <title> [options]         # 新規作成
taskctl plan list [--status <status>]      # 一覧表示
taskctl plan show <plan-id>                # 詳細表示
taskctl plan graph <plan-id> [--format]    # 依存グラフ
taskctl plan start <plan-id>               # 開始
taskctl plan delete <plan-id>              # 削除

# AI サブコマンド
taskctl plan ai generate <prompt> [options]  # タスク生成
taskctl plan ai review <plan-id>             # レビュー
taskctl plan ai approve <plan-id>            # 承認
```

### task

```bash
taskctl task list [options]                  # 一覧表示
taskctl task show <task-id>                  # 詳細表示
taskctl task add --plan-id <id> --title <t>  # 手動追加
taskctl task edit <task-id> [options]        # 編集
taskctl task delete <task-id>                # 削除
taskctl task depends <id> --on <dep-id>      # 依存関係追加
taskctl task undepends <id> --on <dep-id>    # 依存関係削除
taskctl task start <task-id>                 # 開始
taskctl task complete <task-id>              # 完了
```

### wt (worktree)

```bash
taskctl wt init [--count <n>]    # プール初期化
taskctl wt list                  # 一覧表示
taskctl wt status [id]           # ステータス
taskctl wt reset <id>            # リセット
taskctl wt reset --all           # 全てリセット
taskctl wt path <id>             # パス表示
taskctl wt cd <id>               # cd コマンド出力
```

### exec

```bash
taskctl exec parallel [options]  # 並行実行
taskctl exec task <task-id>      # 単一タスク実行
taskctl exec status              # 実行状況
```

### pr

```bash
taskctl pr create <task-id> [options]  # PR 作成
taskctl pr list [options]              # 一覧表示
taskctl pr sync [task-id]              # ステータス同期
taskctl pr merge <task-id> [--squash]  # マージ
taskctl pr close <task-id>             # クローズ
```

## ワークフロー例

### 新機能開発

```bash
# 1. プロジェクト初期化
cd my-app
taskctl init

# 2. プランを作成して AI でタスク生成
taskctl plan ai generate "
  Add shopping cart feature:
  - Cart model to store items
  - Add/remove item APIs
  - Cart total calculation
  - Checkout flow
"

# 3. 生成されたタスクを確認
taskctl plan graph <plan-id>

# 4. プランを開始して並行実行
taskctl plan start <plan-id>
taskctl exec parallel

# 5. 各 worktree で実装
cd ../my-app-worktrees/my-app0
# ... implement ...
git add . && git commit -m "feat: add cart model"

# 6. PR を作成
taskctl pr create <task-id>

# 7. ステータス確認
taskctl status
```

### 手動タスク管理

```bash
# プラン作成
taskctl plan new "Bug fixes for v1.2"

# タスクを手動で追加
taskctl task add --plan-id <id> --title "Fix login redirect"
taskctl task add --plan-id <id> --title "Fix cart total calculation"

# 依存関係を設定
taskctl task depends <task-2> --on <task-1>

# 実行
taskctl plan start <plan-id>
taskctl exec parallel
```

## データ保存場所

| 種別 | パス (macOS) |
|------|-------------|
| データベース | `~/Library/Application Support/taskctl/taskctl.db` |
| グローバル設定 | `~/Library/Application Support/taskctl/config.json` |
| ログ | `~/Library/Application Support/taskctl/logs/` |
| プロジェクト設定 | `<project>/.taskctl/config.json` |

## 開発

```bash
# 開発モードで実行
bun run dev <command>

# ビルド
bun run build

# Lint
bun run lint

# フォーマット
bun run format

# テスト
bun run test
```

## ライセンス

MIT
