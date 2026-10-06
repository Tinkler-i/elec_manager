/**
 * Next 启动钩子。
 *
 * `register()` 在每个新 server 实例启动时调用一次，并且要跑完才开始接请求。
 * 这里只做一件事：把 `JWT_SECRET` 初始化好。
 *
 * 为什么必须在这里做：`src/proxy.ts` 在 Edge runtime 对**每个请求**都要密钥，
 * 而它只能读 `process.env.JWT_SECRET`；负责「环境变量 → jwt_secret 文件 →
 * 生成并持久化」的 `src/lib/auth.ts` 却只在 Node 运行时的 API 路由里被调用。
 * 于是冷启动后、第一次登录之前，proxy 拿不到密钥就抛错，又被自己那个 catch
 * 当成「token 失效」，结果是带着有效 cookie 的用户被踢回登录页、cookie 还被删掉。
 *
 * 实测：本钩子不生效时，全新进程上第一个带有效 cookie 的受保护请求返回 307；
 * 生效后返回 200。
 */
export async function register() {
  // instrumentation 在 Edge 和 Node 两种 runtime 下都会加载。auth.ts 会拉起
  // better-sqlite3，不能进 Edge bundle，所以动态 import 放在 runtime 判断里面。
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { ensureJwtSecret } = await import('./lib/auth');
    ensureJwtSecret();
  }
}
