// This copy of the page lives on GitHub Pages (migovt.org/database), not on
// Vercel — so it can't use a relative /api/lookup path like the Vercel copy
// does. Point it at your deployed Vercel API instead.
//
// Replace this with your real Vercel URL (the one from your Vercel project
// dashboard, e.g. "https://database-acme-32c4.vercel.app" — no trailing
// slash). If you later add a custom subdomain in Vercel, you can swap this
// to that instead.
const API_BASE = 'https://database-acme-32c4.vercel.app';

const form = document.getElementById('searchForm');
const usernameInput = document.getElementById('username');
const searchBtn = document.getElementById('searchBtn');
const statusArea = document.getElementById('statusArea');
const resultArea = document.getElementById('resultArea');

function setStatus(message, isError) {
  if (!message) {
    statusArea.hidden = true;
    statusArea.textContent = '';
    statusArea.classList.remove('error');
    return;
  }
  statusArea.hidden = false;
  statusArea.textContent = message;
  statusArea.classList.toggle('error', !!isError);
}

function clearResult() {
  resultArea.hidden = true;
  resultArea.innerHTML = '';
}

function formatSeconds(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds || 0));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}m ${sec}s`;
}

function formatMoney(amount) {
  const n = Math.floor(Number(amount) || 0);
  return '$' + n.toLocaleString('en-US');
}

function formatDate(unixSeconds) {
  if (!unixSeconds) return 'Unknown date';
  const d = new Date(unixSeconds * 1000);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) +
    ' · ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function outcomeLabel(outcome) {
  if (outcome === 'bail') return 'Bail Posted';
  if (outcome === 'served') return 'Sentence Served';
  return 'Pending';
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderResult(data) {
  const isClean = data.clean || data.totalArrests === 0;
  const displayName = escapeHtml(data.name || data.username || 'Unknown Subject');
  const handle = escapeHtml(data.username || '');

  const avatarStyle = data.avatarUrl
    ? `background-image:url('${data.avatarUrl}')`
    : '';

  const stampHtml = isClean
    ? `<div class="stamp">No Record</div>`
    : `<div class="stamp on-file">On File</div>`;

  let bodyHtml = '';

  if (isClean) {
    bodyHtml = `<p class="clean-note">No booking history found for this subject. Record is clean.</p>`;
  } else {
    const entries = data.arrests.map((entry) => {
      const chargesHtml = (entry.charges || []).map((c) => `
        <li>${escapeHtml(c.name)}<span class="statute">${escapeHtml(c.statute || '')}${c.class ? ' · ' + escapeHtml(c.class) : ''}</span></li>
      `).join('');

      const outcomeClass = entry.outcome === 'bail' ? 'bail' : entry.outcome === 'served' ? 'served' : 'pending';

      const narrativeHtml = entry.narrative
        ? `<p class="arrest-narrative">"${escapeHtml(entry.narrative)}"</p>`
        : '';

      const bailNote = entry.outcome === 'bail' && entry.bailPaid
        ? ` · Bail paid: ${formatMoney(entry.bailPaid)}`
        : '';

      return `
        <div class="arrest-entry">
          <div class="arrest-top">
            <span class="arrest-date">${formatDate(entry.timestamp)}</span>
            <span class="outcome-tag ${outcomeClass}">${outcomeLabel(entry.outcome)}</span>
          </div>
          <ul class="charge-list">${chargesHtml}</ul>
          ${narrativeHtml}
          <p class="arrest-footer">Sentence: ${formatSeconds(entry.totalSentence)} · Bail set: ${formatMoney(entry.bail)}${bailNote} · Booking officer: ${escapeHtml(entry.officer && entry.officer.name || 'Unknown')}</p>
        </div>
      `;
    }).join('');

    bodyHtml = `
      <p class="arrest-count">${data.totalArrests} record${data.totalArrests === 1 ? '' : 's'} on file</p>
      ${entries}
    `;
  }

  resultArea.innerHTML = `
    <div class="record-card">
      ${stampHtml}
      <div class="record-header">
        <div class="avatar" style="${avatarStyle}"></div>
        <div class="record-id">
          <p class="name">${displayName}</p>
          <p class="meta">@${handle} · UserId ${data.userId}</p>
        </div>
      </div>
      <div class="record-body">
        ${bodyHtml}
      </div>
    </div>
  `;
  resultArea.hidden = false;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = usernameInput.value.trim();
  if (!username) return;

  clearResult();
  setStatus('Pulling file…', false);
  searchBtn.disabled = true;

  try {
    const res = await fetch(`${API_BASE}/api/lookup?username=${encodeURIComponent(username)}`);
    const data = await res.json();

    if (!res.ok) {
      if (data.error === 'not_found') {
        setStatus(`No Roblox user named "${username}" was found.`, true);
      } else {
        setStatus(data.message || 'Something went wrong. Try again in a moment.', true);
      }
      return;
    }

    setStatus(null);
    renderResult(data);
  } catch (err) {
    console.error(err);
    setStatus('Could not reach the records server. Check your connection and try again.', true);
  } finally {
    searchBtn.disabled = false;
  }
});
