/* ============================================================
   XADREZ ROYALE — Controlador de UI: Torre Royale (Roguelike PvE)
   ============================================================ */

export function createTowerUIController({
  $,
  audio,
  towerRun,
  TOWER_FLOORS,
  TOWER_BOONS,
  toast,
  startMatch,
  showEsportsBanner
}) {
  function openTowerModal(showReward = false) {
    const cfg = towerRun.getCurrentFloorConfig();
    if ($('#towerTitle')) $('#towerTitle').textContent = `🏰 Torre Royale — Andar ${towerRun.floor}/8`;
    if ($('#towerRecordBadge')) {
      $('#towerRecordBadge').textContent = `🏆 Recorde: Andar ${towerRun.bestFloor}/8 · 👑 ${towerRun.clears} Coroa(s)`;
    }

    if ($('#towerLadder')) {
      $('#towerLadder').innerHTML = TOWER_FLOORS.map(f => {
        const cls = f.floor < towerRun.floor ? 'done' : (f.floor === towerRun.floor ? 'current' : '');
        return `<div class="tower-step ${cls}">
          <strong>${f.floor < towerRun.floor ? '✓' : f.avatar}</strong>
          <span>Andar ${f.floor}</span>
          <small>${f.rating}</small>
        </div>`;
      }).join('');
    }

    if ($('#towerFloorCard')) {
      const ruleTag = cfg.ruleset === 'royale'
        ? '🔥 Battle Royale 3D'
        : (cfg.use960 ? '🎲 Xadrez 960 + Heróis' : '⚡ Poderes de Heróis');
      $('#towerFloorCard').innerHTML = `
        <div>
          <div class="modal-eyebrow">PRÓXIMO DESAFIO · ${ruleTag.toUpperCase()}</div>
          <strong style="font-size:16px;color:#F4C96B">${cfg.avatar} Andar ${cfg.floor}: ${cfg.name} — ${cfg.guardian} (${cfg.rating} Elo)</strong>
          <div style="font-size:12px;color:var(--text-dim);margin-top:3px">${cfg.desc}</div>
        </div>
      `;
    }

    if ($('#towerBoonCount')) $('#towerBoonCount').textContent = String(towerRun.boons.length);
    if ($('#towerActiveBoons')) {
      $('#towerActiveBoons').innerHTML = towerRun.boons.length
        ? towerRun.boons.map(id => {
            const b = TOWER_BOONS.find(x => x.id === id);
            return b ? `<span class="tower-boon-chip" title="${b.desc}">${b.icon} ${b.name}</span>` : '';
          }).join('')
        : '<span class="status-msg" style="padding:4px 0">Vença andares para escolher Relíquias & Bênçãos permanentes!</span>';
    }

    const rewardBox = $('#towerRewardBox');
    const rewardGrid = $('#towerRewardGrid');
    if (rewardBox && rewardGrid) {
      rewardBox.classList.toggle('hide', !showReward);
      if (showReward) {
        const choices = towerRun.getRewardChoices(3);
        rewardGrid.innerHTML = choices.map(b => `
          <button type="button" class="tower-reward-btn" data-boon="${b.id}">
            <strong>${b.icon} ${b.name}</strong>
            <small>${b.desc}</small>
          </button>
        `).join('');
        rewardGrid.querySelectorAll('[data-boon]').forEach(btn => {
          btn.onclick = () => {
            audio.promote();
            towerRun.addBoon(btn.dataset.boon);
            const picked = TOWER_BOONS.find(x => x.id === btn.dataset.boon);
            if (picked) toast(`✨ Bênção adquirida: ${picked.icon} ${picked.name}!`);
            openTowerModal(false);
          };
        });
      }
    }

    $('#overOverlay')?.classList.add('hide');
    $('#towerOverlay')?.classList.remove('hide');
  }

  function bindEvents() {
    if ($('#btnStartTower')) $('#btnStartTower').onclick = () => { audio.click(); openTowerModal(false); };
    if ($('#btnCloseTower')) $('#btnCloseTower').onclick = () => $('#towerOverlay')?.classList.add('hide');
    if ($('#btnTowerReset')) {
      $('#btnTowerReset').onclick = () => {
        towerRun.startNewRun();
        toast('🔄 Escalada da Torre Royale reiniciada no Andar 1!');
        openTowerModal(false);
      };
    }
    if ($('#btnTowerFight')) {
      $('#btnTowerFight').onclick = () => {
        $('#towerOverlay')?.classList.add('hide');
        startMatch('pve', { isTower: true });
        const cfg = towerRun.getCurrentFloorConfig();
        showEsportsBanner(`🏰 ANDAR ${cfg.floor}/8 · ${cfg.name.toUpperCase()}`, `Vs ${cfg.guardian} (${cfg.rating} Elo)`, 'gold', 3000);
      };
    }
  }

  return { openTowerModal, bindEvents };
}
