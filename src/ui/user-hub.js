/* ============================================================
   XADREZ ROYALE — Controlador de UI: Central do Jogador Unificada
   (Perfil & Conquistas + Amigos & Online + Ranking Top 10)
   ============================================================ */

export function createUserHubController({
  $,
  $$,
  audio,
  online,
  ensureOnline,
  getLeague,
  ACHIEVEMENTS,
  unlockedAch,
  solvedPuzzles,
  TACTICAL_PUZZLES,
  towerRun,
  puzzleRush,
  getNick,
  getOnlineTc,
  toast
}) {
  function refreshTopUserPill() {
    const r = online.profile?.rating || 1200;
    const lg = getLeague(r);
    if ($('#topUserIcon')) $('#topUserIcon').textContent = lg.icon;
    if ($('#topUserNick')) $('#topUserNick').textContent = getNick();
    if ($('#topUserElo')) $('#topUserElo').textContent = r;
  }

  function renderUserOverview() {
    const r = online.profile?.rating || 1200;
    const lg = getLeague(r);
    const games = online.profile?.games || 0;
    const wins = online.profile?.wins || 0;
    refreshTopUserPill();
    if ($('#profBadgeIcon')) $('#profBadgeIcon').textContent = lg.icon;
    if ($('#profTitle')) $('#profTitle').textContent = getNick();
    const banner = $('#profLeagueBanner');
    if (banner) {
      banner.innerHTML = `${lg.icon} <strong>Liga ${lg.name}</strong> · ${r} Elo${online.isVipDev() ? ' · 👑 VIP' : ''}`;
    }
    const span = lg.max === Infinity ? 1 : Math.max(1, lg.max - lg.min + 1);
    const pct = lg.max === Infinity ? 100 : Math.min(100, Math.max(6, Math.round(((r - lg.min) / span) * 100)));
    if ($('#profLeagueCurr')) $('#profLeagueCurr').textContent = `${lg.icon} Liga ${lg.name} (${lg.min}+ Elo)`;
    if ($('#profLeagueNext')) {
      $('#profLeagueNext').textContent = lg.max === Infinity ? '⚜️ Nível Máximo!' : `Próxima: ${lg.max + 1} Elo`;
    }
    if ($('#profLeagueFill')) $('#profLeagueFill').style.width = `${pct}%`;

    const stats = $('#profStatsGrid');
    if (stats) {
      stats.innerHTML = `
        <div class="stat-box"><strong>${r}</strong><small>Rating Elo</small></div>
        <div class="stat-box"><strong>${games} (${wins}V)</strong><small>Partidas Online</small></div>
        <div class="stat-box"><strong>Andar ${towerRun.bestFloor}/8</strong><small>Torre Royale (${towerRun.clears}👑)</small></div>
        <div class="stat-box"><strong>${solvedPuzzles.size}/${TACTICAL_PUZZLES.length} · 🔥${puzzleRush.bestScore}</strong><small>Puzzles & Rush</small></div>
      `;
    }
    if ($('#achGrid')) {
      $('#achGrid').innerHTML = ACHIEVEMENTS.map(a => {
        const unlocked = unlockedAch.has(a.id);
        return `<div class="ach-card ${unlocked ? 'unlocked' : ''}">
          <div class="ach-icon">${a.icon}</div>
          <div class="ach-meta">
            <strong>${a.name} ${unlocked ? '✓' : ''}</strong>
            <small>${a.desc}</small>
          </div>
        </div>`;
      }).join('');
    }
  }

  async function loadSocialTab() {
    $('#onlinePlayersList').innerHTML = '<div class="status-msg">Carregando jogadores…</div>';
    $('#friendsList').innerHTML = '<div class="status-msg">Carregando amigos…</div>';
    if (!(await ensureOnline())) {
      $('#onlinePlayersList').innerHTML = '<div class="status-msg">Conecte-se ao modo online para ver jogadores ativos.</div>';
      $('#friendsList').innerHTML = '<div class="status-msg">Modo online indisponível.</div>';
      return;
    }
    await online.updateActive();
    const [players, friends] = await Promise.all([
      online.listOnlinePlayers(15),
      online.listFriends()
    ]);
    const friendIds = new Set(friends.map(f => f.uid));

    const renderChallengeHandlers = root => {
      root.querySelectorAll('[data-challenge]').forEach(btn => {
        btn.onclick = async () => {
          const target = {
            uid: btn.dataset.challenge,
            name: btn.dataset.name,
            rating: Number(btn.dataset.rating) || 1200
          };
          btn.disabled = true;
          btn.textContent = '⏳ Enviado';
          try {
            const chId = await online.sendChallenge(target, getOnlineTc());
            toast(`Desafio enviado para ${target.name}!`);
            online.listenOutgoingChallenge(chId, async ch => {
              if (ch.status === 'accepted' && ch.gameId) {
                $('#profileOverlay').classList.add('hide');
                await online.joinChallengeAsWhite(ch);
              } else if (ch.status === 'declined') {
                toast(`${target.name} recusou o desafio.`);
              }
            });
          } catch {
            toast('Falha ao enviar desafio');
          }
        };
      });
      root.querySelectorAll('[data-friend]').forEach(btn => {
        btn.onclick = async () => {
          const target = {
            uid: btn.dataset.friend,
            name: btn.dataset.name,
            rating: Number(btn.dataset.rating) || 1200
          };
          await online.addFriend(target);
          btn.disabled = true;
          btn.textContent = '✓ Amigo';
          toast(`${target.name} adicionado aos amigos!`);
        };
      });
    };

    $('#onlinePlayersList').innerHTML = players.map(p => {
      const lg = getLeague(p.rating || 1200);
      const isFr = friendIds.has(p.uid);
      return `<div class="lb-row">
        <div class="row-meta">
          <strong>${lg.icon} ${p.name}</strong>
          <small>${p.rating || 1200} Elo</small>
        </div>
        <div class="row-actions">
          <button class="btn-secondary btn-mini" data-challenge="${p.uid}" data-name="${p.name}" data-rating="${p.rating || 1200}">⚔️ Desafiar</button>
          ${isFr ? '' : `<button class="btn-secondary btn-mini" data-friend="${p.uid}" data-name="${p.name}" data-rating="${p.rating || 1200}">+ Amigo</button>`}
        </div>
      </div>`;
    }).join('') || '<div class="status-msg">Nenhum outro jogador online no momento.</div>';

    $('#friendsList').innerHTML = friends.map(f => {
      const lg = getLeague(f.rating || 1200);
      return `<div class="lb-row">
        <div class="row-meta">
          <strong>${lg.icon} ${f.name}</strong>
          <small>${f.rating || 1200} Elo</small>
        </div>
        <div class="row-actions">
          <button class="btn-secondary btn-mini" data-challenge="${f.uid}" data-name="${f.name}" data-rating="${f.rating || 1200}">⚔️ Desafiar</button>
        </div>
      </div>`;
    }).join('') || '<div class="status-msg">Adicione jogadores da lista acima para desafiar rapidamente.</div>';

    renderChallengeHandlers($('#onlinePlayersList'));
    renderChallengeHandlers($('#friendsList'));
  }

  async function loadRankingTab() {
    $('#lbList').innerHTML = '<div class="status-msg">Carregando…</div>';
    if (!(await ensureOnline())) {
      $('#lbList').innerHTML = '<div class="status-msg">Conecte-se ao modo online para carregar o Top 10.</div>';
      return;
    }
    const list = await online.leaderboard(10);
    $('#lbList').innerHTML = list.map((p, i) => {
      const lg = getLeague(p.rating || 1200);
      return `<div class="lb-row"><span>${i + 1}. ${lg.icon} ${p.name}</span><strong>${p.rating} Elo</strong></div>`;
    }).join('') || '<div class="status-msg">Nenhum jogador no ranking ainda.</div>';
  }

  function openUserHub(tab = 'overview') {
    renderUserOverview();
    $$('#userHubTabs .studio-tab').forEach(b => b.classList.toggle('active', b.dataset.utab === tab));
    ['overview', 'social', 'ranking'].forEach(k => {
      const pane = $(`#utab-${k}`);
      if (pane) {
        const isActive = k === tab;
        pane.classList.toggle('hide', !isActive);
        pane.style.display = isActive ? '' : 'none';
      }
    });
    $('#profileOverlay')?.classList.remove('hide');
    if (tab === 'social') loadSocialTab();
    else if (tab === 'ranking') loadRankingTab();
  }

  function bindEvents() {
    $$('#userHubTabs .studio-tab').forEach(btn => {
      btn.onclick = () => {
        audio.click();
        openUserHub(btn.dataset.utab);
      };
    });
    if ($('#btnTopUser')) $('#btnTopUser').onclick = () => { audio.click(); openUserHub('overview'); };
    if ($('#btnProfile')) $('#btnProfile').onclick = () => { audio.click(); openUserHub('overview'); };
    if ($('#btnSocial')) $('#btnSocial').onclick = () => { audio.click(); openUserHub('social'); };
    if ($('#btnLeaderboard')) $('#btnLeaderboard').onclick = () => { audio.click(); openUserHub('ranking'); };
    if ($('#btnCloseProfile')) $('#btnCloseProfile').onclick = () => $('#profileOverlay')?.classList.add('hide');
    if ($('#btnCloseSocial')) $('#btnCloseSocial').onclick = () => $('#socialOverlay')?.classList.add('hide');
    if ($('#btnCloseLb')) $('#btnCloseLb').onclick = () => $('#lbOverlay')?.classList.add('hide');
  }

  return { refreshTopUserPill, openUserHub, bindEvents };
}
