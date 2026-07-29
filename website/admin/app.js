const state = { token: sessionStorage.getItem('offerget_admin_token'), users: [], grantUser: null }
const $ = (selector) => document.querySelector(selector)
const text = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char])
const formatTime = (value) => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—'
const formatMoney = (fen) => `¥${(Number(fen || 0) / 100).toFixed(2)}`
function showMessage(message = '', error = true) { const el = $('#global-message'); el.textContent = message; el.style.color = error ? '#fda4af' : '#86efac' }
async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, { ...options, headers: { 'content-type': 'application/json', ...(state.token ? { authorization: `Bearer ${state.token}` } : {}), ...(options.headers || {}) } })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body?.error?.message || '请求失败')
  return body
}
function setAuthenticated(authenticated) { $('#login-view').classList.toggle('hidden', authenticated); $('#console-view').classList.toggle('hidden', !authenticated) }
async function loadOverview() {
  const data = await api('/v1/admin/overview')
  const metrics = [ ['累计用户', data.metrics.totalUsers], ['今日新增', data.metrics.newUsersToday], ['进行中会话', data.metrics.activeSessions], ['已支付订单', data.metrics.paidOrders], ['已收金额', formatMoney(data.metrics.paidRevenueFen)], ['待支付订单', data.metrics.pendingOrders], ['已生成体验码', data.metrics.activationCodes.total], ['已核销体验码', data.metrics.activationCodes.redeemed], ['有效体验码', data.metrics.activationCodes.valid] ]
  $('#metrics').innerHTML = metrics.map(([label, value]) => `<article class="metric"><span>${text(label)}</span><b>${text(value)}</b></article>`).join('')
  $('#updated-at').textContent = `更新于 ${formatTime(data.generatedAt)}`
}
async function loadUsers() {
  const query = $('#user-query').value.trim()
  const data = await api(`/v1/admin/users?limit=100&query=${encodeURIComponent(query)}`)
  state.users = data.users
  $('#users-table').innerHTML = data.users.map((user) => `<tr><td><b>${text(user.email)}</b><br><small>${text(user.id)}</small></td><td>${formatTime(user.createdAt)}</td><td>${user.trialUsed ? '已使用' : '未使用'}</td><td>${text(user.voiceTrialRemaining)} 次</td><td>${text(user.passes.total)}<br><small>付费/补发 ${text(user.passes.paid)} · 体验 ${text(user.passes.activation)}</small></td><td>${user.activeSession ? `<span class="status valid">${text(user.activeSession.kind)} · 至 ${formatTime(user.activeSession.expiresAt)}</span>` : '—'}</td><td><button class="row-action" data-grant="${text(user.id)}">补发权益</button></td></tr>`).join('') || '<tr><td colspan="7">未找到用户</td></tr>'
  document.querySelectorAll('[data-grant]').forEach((button) => button.addEventListener('click', () => openGrant(button.dataset.grant)))
}
async function loadCodes() {
  const data = await api('/v1/admin/activation-codes')
  $('#codes-table').innerHTML = data.codes.map((code) => { const status = code.revokedAt ? ['revoked','已撤销'] : code.redeemedAt ? ['used','已兑换'] : new Date(code.expiresAt) <= new Date() ? ['revoked','已过期'] : ['valid','有效']; return `<tr><td>${text(code.codeHint)}</td><td><small>${text(code.batchId)}</small></td><td>${text(code.label || '—')}</td><td>${formatTime(code.createdAt)}<br><small>到期：${formatTime(code.expiresAt)}</small></td><td><span class="status ${status[0]}">${status[1]}</span></td><td>${text(code.redeemedBy || '—')}</td></tr>` }).join('') || '<tr><td colspan="6">暂无体验码</td></tr>'
}
async function loadOrders() {
  const data = await api('/v1/admin/orders?limit=200')
  $('#orders-table').innerHTML = data.orders.map((order) => `<tr><td><small>${text(order.orderNo)}</small></td><td>${text(order.userEmail)}</td><td>${order.productCode === 'ten_session' ? '10 次卡' : '次卡'}</td><td>${formatMoney(order.amountFen)}</td><td><span class="status ${text(order.status)}">${order.status === 'paid' ? '已支付' : '待支付'}</span></td><td>${order.fulfilledAt ? `完成：${formatTime(order.fulfilledAt)}` : `失效：${formatTime(order.expiresAt)}`}</td></tr>`).join('') || '<tr><td colspan="6">暂无订单</td></tr>'
}
async function loadAudit() {
  const data = await api('/v1/admin/audit-events')
  $('#audit-table').innerHTML = data.events.map((event) => `<tr><td>${formatTime(event.createdAt)}</td><td>${text(event.action)}</td><td>${text(event.target || '—')}</td><td>${text(Object.entries(event.detail || {}).map(([k,v]) => `${k}: ${v}`).join(' · ') || '—')}</td></tr>`).join('') || '<tr><td colspan="4">暂无操作日志</td></tr>'
}
async function refreshAll() { try { await Promise.all([loadOverview(), loadUsers(), loadCodes(), loadOrders(), loadAudit()]); showMessage('', false) } catch (error) { if (String(error.message).includes('登录后台')) logout(); else showMessage(error.message) } }
function openGrant(id) { state.grantUser = state.users.find((user) => user.id === id); if (!state.grantUser) return; $('#grant-user').textContent = state.grantUser.email; $('#grant-dialog').showModal() }
function logout() { state.token = null; sessionStorage.removeItem('offerget_admin_token'); setAuthenticated(false) }
$('#login-form').addEventListener('submit', async (event) => { event.preventDefault(); const message = $('#login-message'); message.textContent = ''; try { const data = await api('/v1/admin/auth/login', { method: 'POST', body: JSON.stringify({ password: $('#password').value }) }); state.token = data.accessToken; sessionStorage.setItem('offerget_admin_token', state.token); $('#password').value = ''; setAuthenticated(true); await refreshAll() } catch (error) { message.textContent = error.message } })
$('#refresh').addEventListener('click', refreshAll)
$('#logout').addEventListener('click', logout)
$('.tabs').addEventListener('click', (event) => { const button = event.target.closest('[data-tab]'); if (!button) return; document.querySelectorAll('.tabs button').forEach((item) => item.classList.toggle('active', item === button)); document.querySelectorAll('.tab-panel').forEach((panel) => panel.classList.toggle('hidden', panel.id !== `tab-${button.dataset.tab}`)) })
$('#user-query').addEventListener('input', () => { clearTimeout(window.userSearchTimer); window.userSearchTimer = setTimeout(loadUsers, 250) })
$('#generate-codes').addEventListener('submit', async (event) => { event.preventDefault(); const values = new FormData(event.target); try { const result = await api('/v1/admin/activation-codes/generate', { method: 'POST', body: JSON.stringify({ count: Number(values.get('count')), expiresInDays: Number(values.get('expiresInDays')), label: values.get('label') }) }); $('#generated-codes').value = result.codes.join('\n'); showMessage(`已生成 ${result.codes.length} 个体验码，请立即安全保存。`, false); await Promise.all([loadCodes(), loadOverview(), loadAudit()]) } catch (error) { showMessage(error.message) } })
$('#copy-codes').addEventListener('click', async () => { const value = $('#generated-codes').value; if (!value) return; try { await navigator.clipboard.writeText(value); showMessage('体验码已复制到剪贴板。', false) } catch { $('#generated-codes').select(); document.execCommand('copy'); showMessage('体验码已复制到剪贴板。', false) } })
$('#cancel-grant').addEventListener('click', () => $('#grant-dialog').close())
$('#grant-form').addEventListener('submit', async (event) => { event.preventDefault(); if (!state.grantUser) return; const values = new FormData(event.target); try { await api(`/v1/admin/users/${state.grantUser.id}/passes`, { method: 'POST', body: JSON.stringify({ count: Number(values.get('count')), expiresInDays: Number(values.get('expiresInDays')), reason: values.get('reason') }) }); $('#grant-dialog').close(); showMessage('权益已补发，并已写入操作日志。', false); await refreshAll() } catch (error) { showMessage(error.message) } })
if (state.token) { setAuthenticated(true); refreshAll() }
