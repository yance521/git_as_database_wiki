# Story

Story 是一个基于 Git hooks 的工程记忆工具。

它的目标是：开发者继续使用原生 `git commit`、`git commit --amend`、
`git rebase`、`git cherry-pick`，Story 在提交时自动把本次编码会话证据绑定到
commit，并把可迁移、可追溯的工程记忆写入仓库自己的 checkpoint ref。

## 1. Story 解决什么问题

日常开发里，真正关键的信息往往不只在代码里，还在这些上下文里：

- 需求背景为什么变成现在这样
- 为什么选 A 方案而不是 B 方案
- 中间试错过哪些路径
- 修复一个问题时到底规避了什么风险

这些信息通常只存在于临时会话、Agent 对话、工具调用和本地推理过程里。
一旦 commit 落下，代码还在，但“为什么这样改”很快就丢了。

Story 提供一条尽量不打断开发流的路径：

1. 在提交前准备或发现会话证据
2. `git commit` 时自动注入 Story trailers
3. `post-commit` 自动把证据固化到 checkpoint ref
4. 后续按 commit 查看会话、生成 review、生成 handoff
5. amend / rewrite 后继续保留逻辑绑定与 lineage

## 2. 当前能力

当前实现已经包含：

- 通用 JSONL transcript 手动 attach
- `commit-msg`、`post-commit`、`post-rewrite` hook
- 链式 hook 安装与恢复
- checkpoint ref 持久化
- checkpoint 查询、列表、重建
- review / handoff 文档生成
- rewrite lineage 记录
- installable 包导出
- clone / fetch checkpoint ref 后继续读取证据
- Codex session 自动发现
- Codex session 手动绑定 branch
- 按 branch 查询当前仓库的 Codex sessions

## 3. 运行要求

- Git 2.30+
- Node.js 22+

## 4. 安装

### 4.1 Vendored mode

把 `story/` 目录直接放进目标仓库：

```bash
cp -R story /path/to/repository/story
cd /path/to/repository
node story/bin/story.js enable
```

### 4.2 Package mode

如果 Story 作为包发布，可直接使用：

```bash
story enable
```

### 4.3 enable 会做什么

`story enable` 会安装这三个 hook wrapper：

- `commit-msg`
- `post-commit`
- `post-rewrite`

如果仓库原本已有 hook，Story 会把它们备份到 `.story/hooks/original/`，
然后以链式方式继续调用，不直接粗暴覆盖原逻辑。

如果你希望 Story 的 hook 失败时阻断提交，可以启用严格模式：

```bash
story enable --strict
```

## 5. 两种使用路径

Story 现在支持两种主路径：

### 路径 A：手动 attach transcript

适合你已经有一份标准 JSONL transcript，希望显式绑定到后续提交。

### 路径 B：自动发现真实 Codex session

适合你刚在 Codex 里完成一轮对话，希望 Story 在 commit 前自动找到相关会话。

当前自动发现策略是：

1. 只看当前仓库对应的真实 Codex sessions
2. 只看 `session_meta.payload.git.branch` 已存在的 session
3. 只取“上一次提交之后到当前提交之前”有活跃更新的 session
4. 命中的多个 session 会被聚合成一个 Story session，参与后续 checkpoint 流程

## 6. 快速开始

### 6.1 路径 A：手动 attach

先注册 transcript：

```bash
story session attach ./session.jsonl
story session status --json
```

然后正常提交代码：

```bash
git add .
git commit -m "feat: implement checkpoint lookup"
```

提交过程中 Story 会自动完成两件事：

1. 在 commit message 中追加 Story trailers
2. 在 checkpoint ref 中写入本次 commit 对应的证据

### 6.2 路径 B：Codex 自动发现

如果你希望 Story 自动发现 Codex 对话，推荐按这个顺序操作：

1. 在目标仓库里完成一轮 Codex 对话
2. 给当前仓库下最新的 Codex session 设置 branch
3. 确认这个 branch 下已经存在目标 session
4. 正常执行 `git commit`

设置 branch：

```bash
story session add-codex-branch feature/my-work --json
```

查询某个 branch 下有哪些 Codex sessions：

```bash
story session list-codex --branch feature/my-work --json
```

确认无误后，正常提交：

```bash
git add .
git commit -m "feat: wire story codex session discovery"
```

如果当前没有手动 attach 的 session，`commit-msg` hook 会自动尝试发现符合条件的
Codex sessions，并把它们关联进这次提交。

### 6.3 查看当前提交的证据

```bash
story checkpoint show --commit HEAD --json
```

### 6.4 生成 review / handoff

```bash
story review generate --commit HEAD --json
story handoff commit --commit HEAD --json
```

## 7. 命令总览

### 7.1 安装与状态

```bash
story enable [--strict]
story disable
story status --json
```

### 7.2 Session

```bash
story session attach <path>
story session status --json
story session list --json
story session add-codex-branch <branch> --json
story session list-codex --branch <branch> --json
```

### 7.3 Checkpoint

```bash
story checkpoint show --commit <commitish> --json
story checkpoint list --json
story checkpoint rebuild --commit <commitish> --json
```

### 7.4 派生产物

```bash
story review generate --commit <commitish> --json
story handoff commit --commit <commitish> --json
```

### 7.5 恢复与导出

```bash
story repair --json
story index rebuild --json
story export installable --json
```

## 8. Transcript 输入格式

Story v1 使用“通用 JSONL”作为 attach 输入契约。

规则：

- 每个非空行必须是一个 JSON object
- Story 会规范化换行并计算 transcript SHA
- 非法 transcript 不会覆盖当前 session

一个最小示例：

```jsonl
{"type":"user","text":"Implement checkpoint lookup"}
{"type":"assistant","text":"I will bind the session to Git trailers."}
```

目前会优先提取：

- 首条 user 输入作为 prompt
- `agent` / `model` 字段
- staged files、当前分支等上下文

## 9. Codex session 自动发现与手动绑定

### 9.1 Story 现在会读什么数据

对 Codex 来说，Story 读取的是真实 session 落盘文件，而不是测试用 sessions 索引。

当前关注的信息主要来自：

- `session_meta`
- `response_item`

其中会使用到这些字段：

- `session_meta.payload.session_id`
- `session_meta.payload.cwd`
- `session_meta.payload.git.branch`
- `session_meta.payload.model_provider`
- `response_item.payload.role=user`
- `response_item.payload.content`

### 9.2 自动发现的命中条件

当前实现只会自动加入满足这些条件的 Codex session：

1. `cwd` 属于当前仓库
2. `git.branch` 已存在
3. `git.branch === 当前 Git 分支`
4. `session.updated_at` 位于“上一次提交时间”和“当前 hook 执行时间”之间

### 9.3 为什么要先手动设置 branch

因为不是所有 Codex 原始 session 都天然带有稳定的 branch 字段。

所以 Story 提供了一个显式命令：

```bash
story session add-codex-branch <branch> --json
```

它会把“当前仓库下最新的 Codex session”的
`session_meta.payload.git.branch`
改成你指定的值。

### 9.4 如何检查某个 branch 下的 sessions

```bash
story session list-codex --branch <branch> --json
```

默认返回字段包括：

- `session_id`
- `branch`
- `updated_at`
- `source_path`
- `prompt`

## 10. 提交时会发生什么

Story 的核心链路如下：

```text
manual attach or Codex branch binding
                |
                v
commit-msg:
  - read current attached session
  - if absent, auto-discover Codex sessions
  - reserve pending checkpoint
  - inject Story trailers
                |
                v
git commit creates commit
                |
                v
post-commit:
  - finalize checkpoint
  - write evidence into refs/heads/story/checkpoints/v1
                |
                v
post-rewrite:
  - record old/new commit lineage
```

## 11. 数据存放位置

### 11.1 本地运行态

这些文件位于工作树 `.story/` 下，默认是本地运行态：

```text
.story/
  runtime/
    current-session.json
    sessions.json
    pending-commit.json
    install.json
    hook-errors.log
    locks/
  cache/
  generated/
  hooks/
```

这些内容可重建，不是最终的 durable evidence。

### 11.2 Durable evidence

真正的持久化证据写在：

```text
refs/heads/story/checkpoints/v1
```

ref 内部包含：

- checkpoint metadata
- full transcript
- prompt
- content hash
- review markdown
- handoff markdown
- rewrite lineage
- checkpoint index

## 12. 与普通 Git 协作

Story 的证据 ref 不会自动跟业务分支一起同步，需要显式推送或拉取：

```bash
git push origin refs/heads/story/checkpoints/v1
git fetch origin refs/heads/story/checkpoints/v1:refs/heads/story/checkpoints/v1
```

如果希望团队成员都能读到相同的工程记忆，需要把这条 ref 纳入仓库同步策略。

## 13. Rewrite 与 lineage

Story 使用 commit trailers 作为主绑定入口，因此在 amend / rewrite 后仍能保留
逻辑 checkpoint 关联。

`post-rewrite` 会把 old SHA / new SHA 的映射写入 checkpoint ref 的 lineage，
用于后续追溯。

当前测试已覆盖：

- 普通 commit
- 真实 Git hook 流程
- amend lineage
- clone / fetch 后读取 checkpoint ref
- Codex session branch 设置
- Codex session branch 查询
- commit-msg 自动发现 Codex session

## 14. 恢复与排障

### 14.1 查看 hook 错误

如果 hook 执行失败，可先看：

```text
.story/runtime/hook-errors.log
```

### 14.2 重试 pending checkpoint

```bash
story repair --json
```

### 14.3 重建 checkpoint index

```bash
story index rebuild --json
```

### 14.4 重建某个 commit 的 checkpoint 绑定

```bash
story checkpoint rebuild --commit HEAD --json
```

### 14.5 提示 `No Codex session found for the current repository.`

这通常说明当前仓库下没有找到匹配的真实 Codex session。常见原因包括：

- 你不在目标 Git 仓库目录里
- Codex 会话还没有落盘
- `STORY_CODEX_HOME` 指到了错误目录
- 会话里的 `cwd` 不属于当前仓库
- 你查询的 branch 没有对应 session

### 14.6 卸载 Story hooks

```bash
story disable
```

## 15. Skills

Story 当前自带这些配套 skills：

- `using-story`
- `story-current-commit-session`
- `story-review-doc`
- `story-handoff-commit`
- `add_session`

这些 skills 的共同约束是：优先走公开 CLI，不直接读取 `.story/` 或 checkpoint ref。

其中 `add_session` 用来处理当前仓库的真实 Codex sessions，详细说明见：

- [skills/add_session/USAGE.md](file:///Users/bytedance/Desktop/super/story/skills/add_session/USAGE.md)

## 16. 开发与验证

在 `story/` 目录执行：

```bash
npm test
npm run build
```

`build` 当前会检查 TypeScript 源码可被加载；`test` 覆盖单元与集成流程。

## 17. 隐私与安全说明

Story 会持久化 transcript 原文。

这意味着：

- prompt 里出现的敏感信息可能进入 checkpoint ref
- review / handoff 也可能暴露更多上下文
- 是否推送 checkpoint ref，应该由仓库所有者明确决策

在生产使用前，建议配合仓库级访问控制和 transcript 清洗策略。
