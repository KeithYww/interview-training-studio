const hint = document.querySelector('#platform-hint')
const platform = navigator.userAgentData?.platform || navigator.platform || ''
if (/mac/i.test(platform)) {
  hint.textContent = 'M1 / M2 / M3 / M4 请选择 Apple 芯片版；旧款 Mac 请选择 Intel 版'
} else if (/win/i.test(platform)) {
  hint.textContent = '已为你的 Windows 设备推荐下载'
}

document.querySelector('#year').textContent = new Date().getFullYear()
