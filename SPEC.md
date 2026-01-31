# taskctl - AI-Powered Task Management CLI

詳細仕様書

---

## 1. プロジェクト概要

### 1.1 目的

taskctl は、AI 駆動のタスク計画 + Claude Code セッション管理 CLI ツールです。大きな開発タスクを Small CL (Changelist) に分割し、各タスクと Claude Code セッションを 1:1 で紐付けて管理します。MCP サーバーを通じて Claude Code から直接タスク情報を参照できます。

### 1.2 主要な特徴

- **Small CL 分割**: AI が大きなタスクを ~100行程度の小さな変更単位に分割
- **セッション管理**: タスクごとに Claude Code セッション ID を管理し、作業の中断・再開を容易に
- **ブランチ ↔ セッション 1:1 マッピング**: 作業ブランチと Claude Code セッションが一意に対応
- **MCP 統合**: Claude Code から plan/task 情報を MCP 経由で参照
- **依存関係グラフ**: タスク間の依存関係を DAG として管理・可視化
- **GitHub 統合**: gh CLI を使用した PR 管理

### 1.3 ユースケース

1. **大規模機能開発**: 新機能を小さな PR に分割して段階的にマージ
2. **Claude Code 連携**: 各タスクのコンテキストを MCP 経由で Claude Code に提供
3. **作業の中断・再開**: セッション ID で Claude Code の会話を再開
4. **チーム開発**: タスクの依存関係と進捗を可視化

---

## 2. アーキテクチャ

### 2.1 コンポーネント構成

```
┌──────────────────────────────────────────────────────────┐
│                    Claude Code (Client)                    │
│  ┌────────────────────────────────────────────────────┐  │
│  │  MCP Client (connects to taskctl MCP Server)       │  │
│  └────────────────────┬───────────────────────────────┘  │
└───────────────────────┼──────────────────────────────────┘
                        │ stdio
┌───────────────────────▼──────────────────────────────────┐
│                   taskctl MCP Server                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐      │
│  │ Plan Tools  │  │ Task Tools  │  │ Write Tools │      │
│  │ (get/list)  │  │ (get/list)  │  │ (future)    │      │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘      │
└─────────┼────────────────┼────────────────┼──────────────┘
          │                │                │
┌─────────▼────────────────▼────────────────▼──────────────┐
│                    Core Services                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │ Plan Service │  │ Task Service │  │Session Svc   │   │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘   │
└─────────┼────────────────┼────────────────┼──────────────┘
          │                │                │
┌─────────▼────────────────▼────────────────▼──────────────┐
│                   CLI Layer (Commander.js)                 │
│  ┌─────┬──────┬─────┬────────┬────┬────────┬──────┐     │
│  │init │plan  │task │session │ pr │status  │ mcp  │     │
│  └─────┴──────┴─────┴────────┴────┴────────┴──────┘     │
└──────────────────────────┬───────────────────────────────┘
                           │
┌──────────────────────────▼───────────────────────────────┐
│                    Data Access Layer                       │
│  ┌────────────────────────────────────────────────────┐  │
│  │              SQLite (LibSQL) + Drizzle ORM          │  │
│  │  projects │ plans │ tasks │ task_deps │ prs         │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────┬───────────────────────────────┘
                           │
┌──────────────────────────▼───────────────────────────────┐
│                    External Services                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │  Anthropic   │  │  Git CLI     │  │  GitHub CLI  │   │
│  │  Claude API  │  │              │  │  (gh)        │   │
│  └──────────────┘  └──────────────┘  └──────────────┘   │
└──────────────────────────────────────────────────────────┘
```

### 2.2 ディレクトリ構造

```
src/
├── index.ts                    # CLI エントリーポイント
├── commands/                   # CLI コマンド
│   ├── init.ts                # プロジェクト初期化
│   ├── project.ts             # プロジェクト管理
│   ├── plan.ts                # プラン管理
│   ├── task.ts                # タスク管理
│   ├── session.ts             # セッション管理
│   ├── mcp.ts                 # MCP サーバー起動
│   ├── pr.ts                  # PR 管理
│   └── status.ts              # ステータス表示
├── mcp/                        # MCP サーバー
│   ├── index.ts               # McpServer セットアップ
│   ├── tools/
│   │   ├── plan-tools.ts      # get_plan, list_plans
│   │   ├── task-tools.ts      # get_task, list_tasks, get_current_task
│   │   └── write-tools.ts     # claim_task 等 (Phase 2)
│   └── utils.ts               # MCP 共通ユーティリティ
├── services/                   # 共有ビジネスロジック
│   ├── plan-service.ts        # Plan 操作
│   ├── task-service.ts        # Task 操作
│   ├── session-service.ts     # Session マッピング
│   └── pr-service.ts          # PR 操作
├── mastra/                     # AI 連携 (Planning Agent のみ)
│   ├── index.ts               # Mastra インスタンス
│   ├── agents/
│   │   └── planning.ts        # タスク分割 Agent
│   └── workflows/
│       └── planning.ts        # 計画ワークフロー
├── db/
│   ├── schema.ts              # SQLite スキーマ (Drizzle)
│   ├── index.ts               # データベース接続
│   └── repositories/          # データアクセス層
│       ├── index.ts
│       ├── project.ts
│       ├── plan.ts
│       ├── task.ts
│       └── pr.ts
├── graph/
│   ├── dependency-graph.ts    # DAG 計算・可視化
│   └── index.ts
├── integrations/
│   ├── git.ts                 # Git 操作
│   └── github.ts              # gh CLI ラッパー
└── utils/
    ├── config.ts              # 設定管理
    ├── paths.ts               # パス解決
    └── id.ts                  # ULID 生成
```

### 2.3 データ保存場所

| データ種別 | 保存場所 |
|-----------|---------|
| グローバル設定 | `~/Library/Application Support/taskctl/config.json` |
| SQLite DB | `~/Library/Application Support/taskctl/taskctl.db` |
| ログ | `~/Library/Application Support/taskctl/logs/` |

プロジェクトの識別は DB の `projects.path` (リポジトリルートパスの UNIQUE 制約) で行います。プロジェクトローカルの設定ファイルは使用しません。

---

## 3. データモデル

### 3.1 ER 図

```
┌─────────────┐       ┌─────────────┐       ┌─────────────┐
│  projects   │       │    plans    │       │   tasks     │
├─────────────┤       ├─────────────┤       ├─────────────┤
│ id (PK)     │◄──┐   │ id (PK)     │◄──┐   │ id (PK)     │
│ name        │   │   │ project_id  │───┘   │ plan_id     │───┐
│ path        │   │   │ title       │       │ title       │   │
│ remote_url  │   │   │ description │       │ description │   │
│ main_branch │   │   │ source_br.. │       │ status      │   │
│ created_at  │   │   │ status      │       │ level       │   │
│ updated_at  │   │   │ created_at  │       │ est._lines  │   │
└─────────────┘   │   │ updated_at  │       │ branch_name │   │
                  │   └─────────────┘       │ session_id  │   │
                  │                         │ created_at  │   │
                  │                         │ updated_at  │   │
                  │                         └─────────────┘   │
                  │                               ▲           │
                  │       ┌─────────────┐         │           │
                  │       │ task_deps   │         │           │
                  │       ├─────────────┤         │           │
                  │       │ id (PK)     │         │           │
                  │       │ task_id     │─────────┘           │
                  │       │ depends_on  │─────────────────────┘
                  │       │ created_at  │
                  │       └─────────────┘
                  │
                  │       ┌─────────────┐
                  │       │    prs      │
                  │       ├─────────────┤
                  └───────│ id (PK)     │
                          │ task_id     │
                          │ number      │
                          │ url         │
                          │ status      │
                          │ base_branch │
                          │ head_branch │
                          │ created_at  │
                          │ updated_at  │
                          └─────────────┘
```

### 3.2 テーブル定義

#### projects テーブル

| カラム | 型 | 説明 |
|--------|------|------|
| id | TEXT (ULID) | 主キー |
| name | TEXT | プロジェクト名 |
| path | TEXT | リポジトリのルートパス (UNIQUE) |
| remote_url | TEXT | リモート URL (nullable) |
| main_branch | TEXT | メインブランチ名 (default: 'main') |
| created_at | TEXT (ISO8601) | 作成日時 |
| updated_at | TEXT (ISO8601) | 更新日時 |

#### plans テーブル

| カラム | 型 | 説明 |
|--------|------|------|
| id | TEXT (ULID) | 主キー |
| project_id | TEXT | プロジェクト ID (FK) |
| title | TEXT | プラン名 |
| description | TEXT | プランの説明 (nullable) |
| source_branch | TEXT | 作業元ブランチ |
| status | TEXT | ステータス (enum) |
| created_at | TEXT (ISO8601) | 作成日時 |
| updated_at | TEXT (ISO8601) | 更新日時 |

**status enum**: `draft`, `planning`, `ready`, `in_progress`, `completed`, `archived`

#### tasks テーブル

| カラム | 型 | 説明 |
|--------|------|------|
| id | TEXT (ULID) | 主キー |
| plan_id | TEXT | プラン ID (FK) |
| title | TEXT | タスク名 |
| description | TEXT | タスクの詳細説明 |
| status | TEXT | ステータス (enum) |
| level | INTEGER | DAG のレベル (0が最初) |
| estimated_lines | INTEGER | 推定変更行数 (nullable) |
| branch_name | TEXT | ブランチ名 (nullable) |
| session_id | TEXT | Claude Code セッション ID (nullable) |
| created_at | TEXT (ISO8601) | 作成日時 |
| updated_at | TEXT (ISO8601) | 更新日時 |

**status enum**: `pending`, `ready`, `in_progress`, `pr_created`, `in_review`, `completed`, `blocked`

**制約**: branch_name と session_id は 1:1 対応。session_id が設定される場合、必ず branch_name も設定済み。

#### task_deps テーブル

| カラム | 型 | 説明 |
|--------|------|------|
| id | TEXT (ULID) | 主キー |
| task_id | TEXT | タスク ID (FK) |
| depends_on_id | TEXT | 依存先タスク ID (FK) |
| created_at | TEXT (ISO8601) | 作成日時 |

**制約**: UNIQUE(task_id, depends_on_id)

#### prs テーブル

| カラム | 型 | 説明 |
|--------|------|------|
| id | TEXT (ULID) | 主キー |
| task_id | TEXT | タスク ID (FK) |
| number | INTEGER | GitHub PR 番号 |
| url | TEXT | PR URL |
| status | TEXT | ステータス (enum) |
| base_branch | TEXT | ベースブランチ |
| head_branch | TEXT | ヘッドブランチ |
| created_at | TEXT (ISO8601) | 作成日時 |
| updated_at | TEXT (ISO8601) | 更新日時 |

**status enum**: `draft`, `open`, `in_review`, `approved`, `merged`, `closed`

### 3.3 インデックス

```sql
CREATE INDEX idx_tasks_session_id ON tasks(session_id);
CREATE INDEX idx_tasks_branch_name ON tasks(branch_name);
CREATE INDEX idx_tasks_plan_id ON tasks(plan_id);
CREATE INDEX idx_prs_task_id ON prs(task_id);
```

---

## 4. CLI コマンド仕様

### 4.1 グローバルオプション

```
--verbose, -v     詳細ログ出力
--quiet, -q       最小限の出力
--help, -h        ヘルプ表示
--version         バージョン表示
```

### 4.2 init コマンド

プロジェクトを taskctl の管理下に置く。

```bash
taskctl init
taskctl init --clone <url>
taskctl init --main-branch master
```

| オプション | 短縮 | 説明 | デフォルト |
|-----------|------|------|-----------|
| --clone | -c | クローンする URL | - |
| --main-branch | -b | メインブランチ名 | main |
| --name | -n | プロジェクト名 | ディレクトリ名 |

**処理フロー**:
1. リポジトリの検証 (git repo であることを確認)
2. SQLite にプロジェクト情報を登録

### 4.3 project コマンド

```bash
taskctl project list
taskctl project show [project-id]
taskctl project current
taskctl project config --main-branch <branch>
taskctl project remove [project-id] --force
```

### 4.4 plan コマンド

計画の作成・管理。

```bash
taskctl plan new "<title>" [--description "<desc>"]
taskctl plan list [--status <status>]
taskctl plan show <plan-id>
taskctl plan ai generate "<prompt>" [--plan-id <id>]
taskctl plan ai review <plan-id>
taskctl plan ai approve <plan-id>
taskctl plan graph <plan-id> [--format ascii|mermaid]
taskctl plan delete <plan-id>
taskctl plan start <plan-id>
```

**AI generate オプション**:

| オプション | 説明 |
|-----------|------|
| --plan-id | 既存プランに追加 |
| --branch | 作業ブランチ (default: current) |
| --max-lines | タスクあたり最大行数 (default: 100) |
| --context | 追加コンテキストファイル |

### 4.5 task コマンド

```bash
taskctl task list [--plan-id <id>] [--status <status>]
taskctl task show <task-id>
taskctl task add --plan-id <id> --title "<title>" [--depends-on <task-id>...]
taskctl task edit <task-id> --title "<title>" --description "<desc>"
taskctl task delete <task-id>
taskctl task depends <task-id> --on <dependency-task-id>
taskctl task undepends <task-id> --on <dependency-task-id>
taskctl task start <task-id>        # ブランチ作成 + status=in_progress
taskctl task open <task-id>         # Claude Code 起動/再開コマンドを出力
taskctl task complete <task-id>
```

**`task start` の処理フロー**:
1. 全依存タスクが completed であることを検証
2. plan の source_branch からブランチを作成: `feature/<plan-short>/<task-short>-<slug>`
3. タスクの status を `in_progress`、branch_name を設定
4. ブランチ名と Claude Code 起動コマンドを表示

**`task open` の処理フロー**:
1. タスクの session_id を検索
2. session_id がある場合: `claude --resume <session-id>` を出力
3. session_id がない場合: `claude` を出力（新規セッション）
4. `eval $(taskctl task open <id>)` で直接起動可能

### 4.6 session コマンド

セッション管理。

```bash
taskctl session set <task-id> <session-id>    # セッション ID を登録
taskctl session list [--plan-id <id>]          # セッション一覧
taskctl session clear <task-id>                # セッション ID をクリア
```

**`session set` の処理フロー**:
1. タスクが存在し、status が `in_progress` であることを検証
2. tasks.session_id を更新

**出力例** (`session list`):
```
Plan: Add authentication feature

  Task ID      Title                    Branch                          Session ID      Status
  01ARZ4KY     Add User model           feature/01AR/01A4-add-user      ses_abc123      in_progress
  01ARZ4LM     Add auth middleware       feature/01AR/01A4-add-auth      -               in_progress
  01ARZ4MN     Add login endpoint        -                               -               ready
```

### 4.7 mcp コマンド

MCP サーバーを起動。

```bash
taskctl mcp [--project-path <path>]
```

**処理フロー**:
1. DB 初期化
2. プロジェクト解決 (cwd or --project-path)
3. McpServer インスタンスを作成
4. ツールを登録 (Phase 1: read ツール, Phase 2: write ツール)
5. StdioServerTransport で接続
6. Claude Code がパイプを閉じるまで待機

### 4.8 pr コマンド

```bash
taskctl pr create <task-id> [--draft] [--title "<title>"]
taskctl pr list [--plan-id <id>] [--status <status>]
taskctl pr sync [task-id]
taskctl pr merge <task-id> [--squash]
taskctl pr close <task-id>
```

### 4.9 status コマンド

```bash
taskctl status [--plan-id <id>] [--json]
```

**出力例**:
```
Project: my-awesome-app
Plan: Add authentication feature (in_progress)

Tasks:
  Level 0 (parallel):
    ✓ [01ARZ4KY] Add User model           [completed]
    ✓ [01ARZ4LM] Add auth middleware      [completed]
  Level 1:
    → [01ARZ4MN] Add login endpoint       [in_progress] session:ses_abc123
    ○ [01ARZ4NP] Add register endpoint    [ready]
  Level 2:
    ○ [01ARZ4PQ] Add JWT refresh          [pending]

Sessions:
  Active: 1 / Total registered: 2

PRs:
  #12 Add User model        [merged]
  #13 Add auth middleware   [approved]
```

---

## 5. MCP サーバー仕様

### 5.1 概要

`taskctl mcp` は MCP (Model Context Protocol) サーバーを stdio トランスポートで起動します。Claude Code がこのサーバーに接続し、plan/task 情報を参照できます。

### 5.2 Claude Code での設定

`.claude/settings.local.json` に以下を追加:

```json
{
  "mcpServers": {
    "taskctl": {
      "command": "taskctl",
      "args": ["mcp"],
      "env": {}
    }
  }
}
```

### 5.3 Phase 1: 参照ツール

#### get_plan

プランの詳細を全タスク・依存関係と共に取得。

**Input Schema**:
```json
{
  "type": "object",
  "properties": {
    "plan_id": { "type": "string", "description": "Plan ID (前方一致可)" }
  },
  "required": ["plan_id"]
}
```

**Output**:
```json
{
  "plan": { "id": "...", "title": "...", "description": "...", "status": "...", "sourceBranch": "..." },
  "tasks": [
    { "id": "...", "title": "...", "status": "...", "level": 0, "branchName": "...", "sessionId": "..." }
  ],
  "dependencies": [
    { "taskId": "...", "dependsOnId": "..." }
  ],
  "progress": { "total": 5, "completed": 2, "inProgress": 1, "pending": 2, "percentComplete": 40 }
}
```

#### get_task

特定タスクの詳細（依存関係、PR 情報含む）を取得。

**Input Schema**:
```json
{
  "type": "object",
  "properties": {
    "task_id": { "type": "string", "description": "Task ID (前方一致可)" }
  },
  "required": ["task_id"]
}
```

**Output**:
```json
{
  "task": { "id": "...", "title": "...", "description": "...", "status": "...", "level": 0, "branchName": "...", "sessionId": "..." },
  "dependencies": [{ "taskId": "...", "title": "...", "status": "..." }],
  "dependents": [{ "taskId": "...", "title": "...", "status": "..." }],
  "pr": { "number": 12, "url": "...", "status": "open" },
  "plan": { "id": "...", "title": "..." }
}
```

#### list_plans

プラン一覧を取得。

**Input Schema**:
```json
{
  "type": "object",
  "properties": {
    "status": { "type": "string", "description": "ステータスフィルタ (optional)" },
    "project_path": { "type": "string", "description": "プロジェクトパス (default: cwd)" }
  }
}
```

#### list_tasks

タスク一覧を取得。

**Input Schema**:
```json
{
  "type": "object",
  "properties": {
    "plan_id": { "type": "string", "description": "プラン ID フィルタ (optional)" },
    "status": { "type": "string", "description": "ステータスフィルタ (optional)" },
    "level": { "type": "number", "description": "レベルフィルタ (optional)" }
  }
}
```

#### get_current_task

現在のブランチまたはセッションに対応するタスクを取得。

**Input Schema**:
```json
{
  "type": "object",
  "properties": {
    "branch_name": { "type": "string", "description": "現在の git ブランチ名 (optional)" },
    "session_id": { "type": "string", "description": "Claude Code セッション ID (optional)" }
  }
}
```

**検索順序**: session_id → branch_name → null

### 5.4 Phase 2: 書き込みツール (将来実装)

#### claim_task

タスクを選択し、Claude Code セッションを登録。

**Input Schema**:
```json
{
  "type": "object",
  "properties": {
    "task_id": { "type": "string" },
    "session_id": { "type": "string" }
  },
  "required": ["task_id", "session_id"]
}
```

**処理**: ブランチ作成 + session_id 設定 + status=in_progress

#### update_task_status

タスクステータスを更新。

#### generate_plan

AI でタスク生成（CLI の `plan ai generate` と同等）。

#### create_plan

新規プラン作成。

---

## 6. セッション管理

### 6.1 ブランチ・セッション・タスクの関係

```
        Task (DB record)
       /        |        \
  branch_name   |    session_id
      |         |         |
  Git Branch    |    Claude Code Session
      |         |         |
      └─────────┴─────────┘
       1:1:1 mapping
```

in_progress のタスクは必ず1つのブランチを持ち、最大1つの Claude Code セッションに紐付きます。

### 6.2 セッション登録フロー

#### Phase 1: 手動登録

```
1. taskctl task start <task-id>
   → ブランチ作成、status=in_progress

2. ユーザーが Claude Code を起動:
   cd <project-path> && git checkout <branch> && claude

3. ユーザーが Claude Code のセッション ID を確認

4. taskctl session set <task-id> <session-id>
   → session_id を DB に保存

5. 後日再開:
   taskctl task open <task-id>
   → "claude --resume <session-id>" を出力
```

#### Phase 2: MCP 経由の自動登録 (将来)

```
1. Claude Code が taskctl MCP サーバーに接続
2. Claude Code: list_tasks(status="ready") で利用可能タスクを表示
3. ユーザーがタスクを選択
4. Claude Code: claim_task(task_id, session_id) を呼び出し
   → taskctl がブランチ作成 + session_id 登録
5. 以降、get_current_task でタスク情報を参照しながら実装
```

### 6.3 ブランチ命名規則

```
feature/<plan-id-short>/<task-id-short>-<slug>
```

例:
```
feature/01ARZ3ND/01ARZ4KY-add-user-model
feature/01ARZ3ND/01ARZ4LM-add-auth-middleware
```

---

## 7. Mastra エージェント仕様

### 7.1 概要

Planning Agent のみを使用。Claude Code が実装を担当するため、Implementation Agent と PR Agent は不要。

### 7.2 Planning Agent

**役割**: タスクの分割と依存関係の分析

**モデル**: claude-sonnet-4-20250514

**入力**:
- プロジェクトの概要 (README, package.json 等)
- 実装対象の機能説明
- 既存のコードベース構造

**出力**:
- Small CL に分割されたタスクリスト
- 各タスクの依存関係 (DAG)
- 推定変更行数

---

## 8. ワークフロー

### 8.1 計画ワークフロー

```
User: taskctl plan ai generate "Add auth feature"
  → プロジェクトコンテキスト収集
  → Planning Agent (Mastra + Anthropic Claude) でタスク分割
  → DAG レベル計算 (トポロジカルソート)
  → SQLite に保存
  → プラン概要を表示
```

### 8.2 タスク実行ワークフロー

```
1. taskctl task start <task-id>
   → 依存タスク完了を検証
   → ブランチ作成 (feature/<plan>/<task>-<slug>)
   → status=in_progress, branch_name 設定

2. Claude Code を起動 (手動 or taskctl task open)
   → Claude Code が MCP 経由で get_current_task
   → タスクの詳細・依存関係を取得

3. Claude Code セッション内で実装
   → 開発者と Claude Code が協調
   → ブランチにコミット

4. taskctl session set <task-id> <session-id>
   → セッション ID を保存 (中断・再開用)

5. taskctl pr create <task-id>
   → ブランチを push
   → gh CLI で PR 作成
   → status=pr_created

6. PR マージ後:
   → taskctl pr merge or taskctl pr sync
   → status=completed
   → 後続タスクが ready に
```

### 8.3 典型的な使用例

```bash
# 1. プロジェクト初期化
cd my-project
taskctl init

# 2. AI でタスク生成
taskctl plan ai generate "
  Implement user authentication with:
  - User model with email/password
  - JWT-based authentication
  - Login/Register/Logout endpoints
"

# 3. プランを確認
taskctl plan graph <plan-id>

# 4. プランを承認・開始
taskctl plan ai approve <plan-id>
taskctl plan start <plan-id>

# 5. タスクを開始
taskctl task start <task-id>
# → Branch created: feature/01AR/01A4-add-user-model
# → Run: claude (to start Claude Code)

# 6. Claude Code を起動
claude  # Claude Code が MCP 経由でタスク情報を参照

# 7. セッション ID を登録
taskctl session set <task-id> <session-id>

# 8. 後日再開
taskctl task open <task-id>
# → claude --resume ses_abc123

# 9. PR 作成
taskctl pr create <task-id>

# 10. ステータス確認
taskctl status
```

---

## 9. 技術的詳細

### 9.1 依存パッケージ

```json
{
  "dependencies": {
    "@mastra/core": "^0.5.0",
    "@ai-sdk/anthropic": "^3.0.15",
    "@modelcontextprotocol/sdk": "^1.x",
    "commander": "^13.1.0",
    "drizzle-orm": "^0.39.1",
    "@libsql/client": "^0.15.0",
    "ulid": "^2.3.0",
    "chalk": "^5.4.1",
    "ora": "^8.1.1",
    "inquirer": "^12.3.2",
    "zod": "^3.x"
  },
  "devDependencies": {
    "typescript": "^5.x",
    "tsx": "^4.x",
    "vitest": "^2.x",
    "@types/node": "^22.x",
    "eslint": "^9.x",
    "prettier": "^3.x"
  }
}
```

### 9.2 環境変数

| 変数名 | 説明 | 必須 |
|--------|------|------|
| ANTHROPIC_API_KEY | Claude API キー | Yes (AI 機能使用時) |
| TASKCTL_DB_PATH | DB パス (オーバーライド用) | No |
| TASKCTL_LOG_LEVEL | ログレベル (debug/info/warn/error) | No |

### 9.3 ID 体系

全ての ID は ULID を使用（時系列ソート可能、URL safe）。

---

## 10. ステータス遷移図

### Task ステータス

```
pending → ready → in_progress → pr_created → in_review → completed
    ↓                  ↓
  blocked ←────────────
```

### PR ステータス

```
draft → open → in_review → approved → merged
                   ↓           ↓
                closed ←───────
```

---

## 11. 実装ロードマップ

### Phase 1: スキーマ変更とクリーンアップ

- worktrees テーブル削除
- tasks に session_id 追加、worktree_id 削除
- prs から worktree_id 削除
- projects から worktree_count 削除
- 関連リポジトリ関数の更新

### Phase 2: CLI コマンド更新

- worktree.ts, exec.ts 削除
- scheduler.ts 削除
- session.ts 新規作成 (session set/list/clear)
- mcp.ts 新規作成 (MCP サーバー起動)
- init.ts 簡素化
- task.ts 更新 (start, open)
- pr.ts から worktree 参照削除
- status.ts 更新

### Phase 3: MCP サーバー実装

- @modelcontextprotocol/sdk 導入
- mcp/ ディレクトリ構築
- Phase 1 参照ツール実装 (get_plan, get_task, list_plans, list_tasks, get_current_task)
- Claude Code 接続テスト

### Phase 4: サービス層抽出

- CLI と MCP で共有するビジネスロジックを services/ に抽出
- CLI コマンドをサービス経由にリファクタリング
- MCP ツールをサービス経由にリファクタリング

### Phase 5: 書き込みツールと仕上げ (将来)

- claim_task, update_task_status, generate_plan, create_plan
- task open コマンドの強化
- テスト追加
- ドキュメント更新

---

## 12. 今後の拡張可能性

- MCP 書き込みツールによる Claude Code からのタスク選択・登録
- CI/CD 連携
- 複数プロジェクト対応の強化
- カスタムプロンプトテンプレート
