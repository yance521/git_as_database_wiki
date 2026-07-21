#!/usr/bin/env node
//Shebang（释伴行 / 脚本头）：告诉操作系统：用哪个解释器来执行这份脚本。
// 这一行 shebang 告诉系统：当用户直接执行 `bin/story.js` 时，
// 请用当前环境里的 `node` 来运行这个文件。
// 例如 Git hook 里执行 `node story/bin/story.js ...` 时不依赖它；
// 但如果以后把这个文件作为可执行命令安装，shebang 就会生效。

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// import.meta.url 是 ES Module 里表示“当前文件 URL”的变量。
// 在 Node.js ESM 中没有 CommonJS 的 __filename / __dirname，
// 所以这里需要先把当前文件 URL 转成本地文件路径。
//
// 例子：
// import.meta.url              => file:///repo/story/bin/story.js
// fileURLToPath(import.meta.url) => /repo/story/bin/story.js
// path.dirname(...)             => /repo/story/bin
const binDir = path.dirname(fileURLToPath(import.meta.url));

// Story 的真实 CLI 入口有两个形态：
//
// 1. 发布到 npm 后：运行 dist/cli/main.js
//    npm 包安装后会位于 node_modules 下面。Node 不允许对 node_modules 里的
//    .ts 文件执行 --experimental-strip-types，所以发布包必须运行编译后的 JS。
//
// 2. 源码开发时：回退运行 src/cli/main.ts
//    仓库本地开发不一定已经执行过 npm run build，所以保留 TS fallback，
//    这样测试和本地调试仍然可以直接使用 bin/story.js。
const distMain = path.resolve(binDir, "../dist/cli/main.js");
const sourceMain = path.resolve(binDir, "../src/cli/main.ts");
const main = existsSync(distMain) ? distMain : sourceMain;
const runsBuiltJavaScript = main === distMain;

// spawnSync 会同步启动一个子进程，并等待它执行结束。
// 在源码开发模式下，这里等价于执行：
//
// node --experimental-strip-types src/cli/main.ts <用户传入的参数>
//
// 在 npm 发布包模式下，这里等价于执行：
//
// node dist/cli/main.js <用户传入的参数>
//
// 为什么要用 --experimental-strip-types？
// 只有 fallback 到 main.ts 时才需要它。Node 22 可以通过这个参数在运行时
// “剥离”类型标注，直接执行 .ts 文件。
const result = spawnSync(
  // process.execPath 是当前正在运行的 Node 可执行文件路径。
  // 用它启动子进程，可以确保子进程使用同一个 Node 版本。
  process.execPath,
  // process.argv 是当前命令收到的完整参数数组：
  // process.argv[0] = node 路径
  // process.argv[1] = 当前脚本路径，也就是 bin/story.js
  // process.argv.slice(2) = 用户真正传入的业务参数
  //
  // 例如用户执行：
  // node bin/story.js hook pre-push origin
  //
  // 转发给 main.ts 的参数就是：
  // hook pre-push origin
  [
    ...(runsBuiltJavaScript ? [] : ["--experimental-strip-types"]),
    main,
    ...process.argv.slice(2),
  ],
  {
    // stdio: "inherit" 表示子进程复用当前进程的标准输入、输出和错误输出。
    // 这样 main.ts 里的 console 输出、报错信息、交互输入都会直接显示给用户。
    stdio: "inherit",

    // env 是传给子进程的环境变量。
    // 先展开 process.env，表示继承当前 shell / Git hook 的全部环境变量；
    // 再额外设置 STORY_ENTRY，告诉 Story 自己的入口脚本在哪里。
    //
    // install hook 时会用 STORY_ENTRY 记录正确的 story.js 路径，
    // 避免 hook 安装后找不到 CLI 入口。
    env: {
      ...process.env,
      STORY_ENTRY: path.resolve(binDir, "story.js"),
    },
  },
);

// 子进程执行结束后，把子进程的退出码原样传给当前进程。
// 这样 Git hook 或 shell 可以正确知道 Story CLI 是成功还是失败。
//
// result.status 可能是 null，所以这里用 ?? 1：
// - 有退出码：使用真实退出码
// - 没有退出码：按失败处理，返回 1
process.exit(result.status ?? 1);
