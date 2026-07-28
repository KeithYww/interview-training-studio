const hint = document.querySelector('#platform-hint')
const platform = navigator.userAgentData?.platform || navigator.platform || ''
if (/mac/i.test(platform)) {
  hint.textContent = '已为你的 macOS 设备推荐下载'
} else if (/win/i.test(platform)) {
  hint.textContent = '已为你的 Windows 设备推荐下载'
}

document.querySelector('#year').textContent = new Date().getFullYear()
