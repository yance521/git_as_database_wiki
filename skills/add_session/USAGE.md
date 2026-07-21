# add_session 使用教程

## 1. 这个 skill 是做什么的

`add_session` 用来处理当前仓库关联的真实 `Codex` 会话，支持两类操作：

1. 把当前仓库下最新的 `Codex` 会话绑定到你指定的 `branch`
2. 查询当前仓库下，某个 `branch` 上已经有哪些 `Codex` 会话

这个 skill 不扫描其他仓库，只处理“当前命令所在仓库”对应的会话。

## 2. 目录结构

当前 skill 目录如下：

```text
story/skills/add_session/
├── SKILL.md
├── USAGE.md
└── scripts/
    ├── list_branch_sessions.sh
    └── set_branch.sh
```

## 3. 前置条件

使用前需要满足这些条件：

1. 你当前在一个 Git 仓库里执行命令
2. 这个仓库对应的 `Codex` 会话已经真实落盘
3. `story/bin/story.js` 可以正常执行

如果你在测试环境里想指定自定义的 Codex 数据目录，可以设置：

```bash
export STORY_CODEX_HOME=/path/to/codex-home
```

不设置时，默认会优先查当前仓库下的 `.codex-home`，再回退到 `~/.codex`。

## 4. 给当前会话设置 branch

用途：
把当前仓库下“最新的 Codex 会话”的
`session_meta.payload.git.branch`
改成你指定的值。

命令：

```bash
cd story/skills/add_session
./scripts/set_branch.sh feature/my-work
```

等价底层命令：

```bash
story/bin/story.js session add-codex-branch feature/my-work --json
```

成功后会返回类似结果：

```json
{
  "session_id": "sess_xxx",
  "branch": "feature/my-work",
  "source_path": "/path/to/rollout.jsonl"
}
```

适用场景：

- 你刚在 Codex 里完成一轮对话，但 session 还没有 branch
- 你想让后续 `commit-msg` hook 能自动发现这个 session
- 你想手动把某个最新会话归到指定分支

## 5. 查询某个 branch 上有哪些 session

用途：
列出当前仓库下，`session_meta.payload.git.branch` 等于指定值的真实 Codex 会话。

命令：

```bash
cd story/skills/add_session
./scripts/list_branch_sessions.sh feature/my-work
```

等价底层命令：

```bash
story/bin/story.js session list-codex --branch feature/my-work --json
```

成功后会返回 JSON 数组，默认字段包括：

- `session_id`
- `branch`
- `updated_at`
- `source_path`
- `prompt`

示例输出：

```json
[
  {
    "session_id": "sess_a",
    "branch": "feature/my-work",
    "updated_at": "2026-07-20T13:01:00.000Z",
    "source_path": "/path/to/rollout-a.jsonl",
    "prompt": "帮我给 story 增加 session 自动关联"
  }
]
```

## 6. 推荐使用顺序

如果你要把某次 Codex 对话和当前开发分支绑定起来，建议按这个顺序：

1. 在目标仓库里完成一轮 Codex 对话
2. 运行 `./scripts/set_branch.sh <branch>`
3. 运行 `./scripts/list_branch_sessions.sh <branch>` 确认会话已归档到目标分支
4. 再执行 Git 提交，让 `story` 的 `commit-msg` hook 自动发现这些 session

## 7. 常见问题

### Q1：提示 `No Codex session found for the current repository.`

说明当前仓库下没有找到匹配的真实 Codex 会话。常见原因：

- 你不在目标 Git 仓库目录里
- Codex 会话还没有落盘
- `STORY_CODEX_HOME` 指到了错误目录
- 会话里的 `cwd` 不属于当前仓库

### Q2：为什么只修改“最新”的 session？

这是当前 skill 的设计边界。它面向“刚完成当前这轮对话，立刻绑定 branch”的场景，所以默认只改当前仓库下最新的 Codex 会话。

### Q3：为什么查 branch 时只看当前仓库？

因为这个 skill 是给 `story` 的 Git 提交关联流程服务的。提交关联天然是仓库内语义，所以这里不会把其他仓库的 Codex session 混进来。

## 8. 一句话总结

`set_branch.sh` 用来“绑定当前会话到指定 branch”，  
`list_branch_sessions.sh` 用来“检查指定 branch 下有哪些真实 Codex session”。
