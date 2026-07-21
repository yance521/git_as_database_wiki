# Story 迁移指南

## 从原型迁移

Story v1 不直接复用旧的 `.story/checkpoints/v1/index.json` 目录格式。先保留
旧目录作为备份，再在目标仓库安装新包：

```bash
cp -R story story.backup
node story/bin/story.js enable
story session attach ./transcript.jsonl
```

旧 checkpoint 可以通过人工导出 transcript 后重新 attach。重新生成的证据会
使用新的 schema version、checkpoint ref 和 trailer 契约。

## 团队迁移

1. 将 `story/` vendored 到仓库或安装包版本。
2. 每位开发者执行 `story enable`。
3. 将 checkpoint ref 纳入远程同步策略：

   ```bash
   git push origin refs/heads/story/checkpoints/v1
   ```

4. 新 clone 后获取该 ref：

   ```bash
   git fetch origin refs/heads/story/checkpoints/v1:refs/heads/story/checkpoints/v1
   ```

## Hook 冲突

`story enable` 会保存已有 hook 并链式调用。升级 Story 时重复执行 enable
即可；`story disable` 只恢复 Story 记录的原 hook。

如果其他工具也重写 hook，先备份当前 hook，再执行：

```bash
story disable
story enable
```

## 隐私与清理

transcript 是持久化证据。安装前确认会话不包含不应进入 Git 的密钥或个人
信息；仓库需要自行配置脱敏、访问控制和 checkpoint ref 的 push 权限。
