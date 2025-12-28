# taskctl SPEC v0.1 (confirmed)

決定事項:

- CLI 名: taskctl
- worktree 生成ディレクトリ: .taskctl/

---

## 0. 目的

- 複数 repo / 複数プロジェクトで、Plan(複数 md)と Task(DAG)と worktree を一元管理する
- Plan/Docs を **repo にコミットせず** ローカル中央ストアで管理し、全 worktree へ **コンテキストを自動配布**（コピペ撲滅）
- 1 タスク=1worktree 前提で、依存関係(DAG)を使った `blocked(auto)` と `next` 提示を行う
- Git 状態（dirty/ahead/behind/last commit 等）を取り込み、進行状況確認のコストを下げる

---

## 1. 非ゴール（v0.1 ではやらない）

- GitHub/GitLab API 連携（PR 作成/更新）
- AI による自動タスク分割（Small CL 分割）
- リッチ TUI
- チーム共有（DB 同期）

---

## 2. 保存先（ローカル中央ストア）

### 2.1 ルート

- macOS: `~/Library/Application Support/taskctl/`
- Linux: `${XDG_DATA_HOME:-~/.local/share}/taskctl/`

### 2.2 構成

taskctl/
db.sqlite
projects/
<projectId>/
meta.json
plans/
<planId>/
docs/
<docSlug>.md
exports/
plan_index.md

### 2.3 worktree 側（生成物のみ）

worktree 内に `.taskctl/` を作る（必ず git 管理外）

- `.taskctl/context.md`
- `.taskctl/plan_index.md`
- `.taskctl/task.json`

git 管理外の担保:

- repo の `.git/info/exclude` に `.taskctl/` を自動追記（idempotent）

---

## 3. ID

- projectId: hash(repo_root_path + remote_url(optional)) の短縮（8〜12 桁）
- planId: `pln_<ulid>`
- taskId: `tsk_<ulid>`（短くしたい場合は表示時に短縮）
- docId: `doc_<ulid>`（内部）

---

## 4. データモデル（SQLite 推奨）

### 4.1 Tables（必須）

- projects(id TEXT PK, name TEXT, repo_root_path TEXT, remote_url TEXT NULL, created_at TEXT, updated_at TEXT)
- plans(id TEXT PK, project_id TEXT, title TEXT, status TEXT, created_at TEXT, updated_at TEXT)
- docs(id TEXT PK, plan_id TEXT, type TEXT, title TEXT, slug TEXT, storage_rel_path TEXT, created_at TEXT, updated_at TEXT)
- tasks(id TEXT PK, plan_id TEXT, title TEXT, goal TEXT, scope TEXT, status TEXT, created_at TEXT, updated_at TEXT)
- task_deps(task_id TEXT, dep_task_id TEXT, PRIMARY KEY(task_id, dep_task_id))
- worktrees(id TEXT PK, task_id TEXT UNIQUE, path TEXT, branch TEXT, created_at TEXT, updated_at TEXT)
- git_cache(worktree_id TEXT PK, dirty INTEGER, ahead INTEGER NULL, behind INTEGER NULL, last_commit_hash TEXT NULL, last_commit_at TEXT NULL, updated_at TEXT)

制約:

- tasks.status は `todo|doing|done`
- blocked は表示上の概念（deps 未完了で blocked(auto)）
- 1 タスク=1worktree を基本とし、worktrees.task_id は UNIQUE

---

## 5. DAG 仕様

- `task_deps`: “task_id は dep_task_id に依存する”
- blocked(auto):
  - deps に done 以外が 1 つでもあれば blocked(auto)=true
- next:
  - status=todo かつ blocked(auto)=false のタスク（複数なら作成順 or id 順）

---

## 6. Git 情報取得（best-effort / 失敗しても落ちない）

- dirty:
  - `git -C <wt> status --porcelain` が空でなければ dirty=true
- branch:
  - `git -C <wt> rev-parse --abbrev-ref HEAD`
- ahead/behind:
  - upstream 取得:
    - `git -C <wt> rev-parse --abbrev-ref --symbolic-full-name @{upstream}`
  - 取得できたら:
    - `git -C <wt> rev-list --left-right --count @{upstream}...HEAD`
  - upstream が無ければ ahead/behind は NULL（表示は "N/A"）
- last commit:
  - `git -C <wt> log -1 --format=%H%n%cI`

---

## 7. CLI コマンド（v0.1 範囲）

### 7.1 Project

- `taskctl init [--name <name>]`
  - cwd から git root 検出
  - remote_url 取得（可能なら）
  - project 登録（既存なら再利用）
- `taskctl projects ls`
- `taskctl projects show <projectId>`

### 7.2 Plan

- `taskctl plan new "<title>"`
- `taskctl plan ls`
- `taskctl plan show <planId>`

### 7.3 Doc（複数 md）

- `taskctl doc new --plan <planId> --type <design|decisions|notes|todo|custom> --slug <slug> [--title "<title>"]`
  - 中央ストア `docs/<slug>.md` を作成
  - 初期テンプレを挿入（type ごと）
- `taskctl doc add --plan <planId> --type <...> --slug <slug> --from <path.md>`
  - 中央ストアへコピー取り込み
- `taskctl doc ls --plan <planId>`
- `taskctl doc open <docId>`
  - $EDITOR を起動。なければパスを出力

### 7.4 Task（Small CL 前提）

- `taskctl task add --plan <planId> --title "<title>" --goal "<goal>" --scope "<scope>"`
- `taskctl task ls --plan <planId> [--status todo|doing|done]`
- `taskctl task show <taskId>`
- `taskctl task start <taskId>`
- `taskctl task done <taskId>`

### 7.5 Dependencies

- `taskctl task deps add <taskId> --on <depTaskId>`
- `taskctl task deps rm <taskId> --on <depTaskId>`
- `taskctl next --plan <planId>`

### 7.6 Worktree

- `taskctl wt create <taskId> [--path <path>] [--branch <branch>]`
  - デフォルト branch:
    - `task/<planId>/<taskId>-<slugified-title>`
  - 実行:
    - `git worktree add <path> -b <branch>`
  - `.git/info/exclude` に `.taskctl/` 追記
  - `ctx gen <taskId>` 実行（生成物作成）
- `taskctl wt ls --plan <planId>`
- `taskctl wt open <taskId>`
  - worktree path を標準出力（`cd "$(taskctl wt open ...)"` 用）
- `taskctl wt rm <taskId> [--force]`
  - dirty=true なら拒否（--force で許可）
  - `git worktree remove <path>`
  - DB の紐付け削除

### 7.7 Context

- `taskctl ctx gen <taskId>`
  - worktree 内 `.taskctl/context.md` / `.taskctl/plan_index.md` / `.taskctl/task.json` を生成
- `taskctl ctx sync --plan <planId>`
  - plan 配下の全 worktree で `ctx gen` を実行
- `taskctl ctx path <taskId>`
  - `.taskctl/context.md` の絶対パスを返す

### 7.8 Status

- `taskctl status --plan <planId>`
  - タスク一覧 + blocked 理由 + worktree + git 情報 を表形式で出す

---

## 8. 生成物仕様

### 8.1 `.taskctl/plan_index.md`

- Plan に紐づく Docs を type 別に列挙
- **中央ストアの Doc 絶対パス**を必ず含める

例:

- Design
  - /abs/.../taskctl/projects/<pid>/plans/<pln>/docs/design.md
- Decisions
  - /abs/.../decisions.md
- Notes
  - /abs/.../notes.md

### 8.2 `.taskctl/task.json`

- taskId / planId / title / goal / scope / deps / worktree path / branch などのメタ

### 8.3 `.taskctl/context.md`（Claude 用）

必ず以下の構造を持つ（Markdown 固定）。

---

# Task Context

## Task

- ID: <taskId>
- Title: <title>
- Status: <todo|doing|done|blocked(auto)>
- Goal:
  <goal>

## Small CL Guardrails

- Scope:
  <scope>
- Non-goals:
  - (optional)
- Rules:
  - 変更は小さく。横断的変更は別タスクに分割する
  - 不明点は decisions.md に追記する

## Dependencies (DAG)

- Requires:
  - <depTaskId> <title> [status]
- Blocked because:
  - (未完了 deps があれば列挙)

## Plan Docs (absolute paths)

- (type 別に絶対パスを列挙)
- Index:
  - <worktree>/.taskctl/plan_index.md

## Git snapshot (best-effort)

- Worktree: <path>
- Branch: <branch>
- Dirty: <true/false>
- Ahead/Behind: <ahead>/<behind> or N/A
- Last commit: <hash> <date>

## PR Description Draft

### Background / Goal

<goal>

### What changed

- (fill)

### Scope / Risk

- <scope>

### How to test

- (fill)

---

---

## 9. 出力例（目安）

### 9.1 `taskctl status --plan <planId>`

| Task  | Status        | Blocked by   | Worktree    | Git            | Updated |
| ----- | ------------- | ------------ | ----------- | -------------- | ------- |
| tsk_x | blocked(auto) | tsk_a, tsk_b | ../wt/tsk_x | dirty, ahead 1 | ...     |
| tsk_y | todo          | -            | -           | -              | ...     |
| tsk_z | doing         | -            | ../wt/tsk_z | clean, N/A     | ...     |

### 9.2 `taskctl next --plan <planId>`

- tsk_y: <title>
- tsk_w: <title>

---

## 10. 受け入れ基準（Acceptance Criteria）

- Plan/Docs が repo 外（中央ストア）に保存される
- `wt create` で `.taskctl/context.md` が worktree に生成され、Doc の絶対パスが含まれる
- `ctx sync` が plan 配下全 worktree へ一括反映できる
- DAG で blocked(auto) と next が正しく機能する
- `status` でタスク ×worktree×git 状態が一目で分かる
- `.taskctl/` が `.git/info/exclude` により git に乗らない（重複追記しない）
