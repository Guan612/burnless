/**
 * 对局邀请分享：私房/匹配房通用。优先系统分享面板（手机原生体验），
 * 失败或桌面环境降级为复制链接到剪贴板；结果由调用方做按钮反馈。
 */
export type ShareOutcome = 'shared' | 'copied' | 'cancelled' | 'failed'

export async function shareInvite(matchId: string): Promise<ShareOutcome> {
  const url = `${window.location.origin}/match/${matchId}`
  const nav = navigator as Navigator & { share?: (data: ShareData) => Promise<void> }
  if (typeof nav.share === 'function') {
    try {
      await nav.share({ title: '不烧心 · 一起来摆摊', text: '夜市开摊，来跟我抢生意', url })
      return 'shared'
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled'
      // 系统分享不可用 → 降级复制
    }
  }
  try {
    await navigator.clipboard.writeText(url)
    return 'copied'
  } catch {
    return 'failed'
  }
}
