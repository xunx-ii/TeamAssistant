/**
 * 限流模块
 *
 * 全局并发信号量：限制同时执行的上游 API 请求数（保护上游并发上限），
 * 超出部分按 FIFO 排队，支持排队超时与队列长度上限。
 */
export class Semaphore {
  /**
   * @param {object} options
   * @param {number} options.max - 最大并发数（>=1）
   * @param {number} options.queueLimit - 排队等待的最大请求数，0 表示不限制
   * @param {number} options.timeoutMs - 排队超时（毫秒），0 表示不超时
   */
  constructor({ max, queueLimit = 0, timeoutMs = 0 }) {
    this.max = Math.max(1, Math.floor(max));
    this.queueLimit = queueLimit;
    this.timeoutMs = timeoutMs;
    this.count = 0;
    this.waiters = []; // 排队中的 { resolve, timer }
  }

  /** 排队中的请求数 */
  get pending() {
    return this.waiters.length;
  }

  /**
   * 获取许可（可等待）。返回 true 表示获得许可，false 表示超时或队列已满被拒绝。
   * 获取失败时无需调用 release()。
   */
  acquire() {
    if (this.count < this.max) {
      this.count++;
      return Promise.resolve(true);
    }
    // 队列满：直接拒绝
    if (this.queueLimit > 0 && this.waiters.length >= this.queueLimit) {
      return Promise.resolve(false);
    }

    return new Promise((resolve) => {
      let settled = false;
      const finish = (ok) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(ok);
      };
      const timer = this.timeoutMs > 0
        ? setTimeout(() => {
            // 从队列移除自己（若还在等），返回失败
            const idx = this.waiters.indexOf(entry);
            if (idx >= 0) this.waiters.splice(idx, 1);
            finish(false);
          }, this.timeoutMs)
        : null;
      const entry = {
        resolve: () => {
          this.count++;
          finish(true);
        },
        timer,
      };
      this.waiters.push(entry);
    });
  }

  /** 释放许可并唤醒下一个等待者（只对成功 acquire 的调用使用） */
  release() {
    this.count--;
    const next = this.waiters.shift();
    if (next) next.resolve();
  }
}
