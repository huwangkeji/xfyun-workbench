'use strict';

/**
 * express 4 不会捕获 async 路由 handler 抛出的异常：
 *  rejected promise 会直接升级为 unhandledRejection，把整个 node 进程打挂
 *  （历史上 POST /api/chat 的一次 TypeError 就是这样杀掉服务，前端全部请求变成 Failed to fetch）。
 * 用该包装器统一捕获并转交统一错误中间件，返回 500 JSON 而不是进程退出。
 */
module.exports = function asyncHandler(fn) {
  return function (req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};
