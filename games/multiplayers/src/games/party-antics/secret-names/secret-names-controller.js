export class SecretNamesController {
  constructor(session, container) {
    this.session = session;
    this.container = container;

    this.publicState = null;
    this.privateState = null;
    this.isCardRevealed = true;

    this.setupNetworkHandlers();
  }

  setupNetworkHandlers() {
    this.session.on('stateUpdate', (state) => {
      this.publicState = state;
      this.render();
    });

    this.session.on('privatePayload', (data) => {
      if (data.game === 'secret-names') {
        this.privateState = data;
        this.isCardRevealed = true;
        this.render();
      }
    });
  }

  render() {
    if (!this.container || !this.publicState) return;

    const isReveal = this.publicState.phase === 'REVEAL';

    this.container.innerHTML = `
      <div class="controller-screen">
        <header class="controller-header">
          <div class="user-pill">${this.session.avatar} ${this.session.playerName}</div>
          <div class="room-pill">Secret Target</div>
        </header>

        <div class="controller-body">
          ${isReveal ? `
            <div class="glass-card" style="text-align:center; padding:30px 16px;">
              <h2>Missions Completed!</h2>
              <p style="color:var(--text-secondary); margin-top:8px;">Look at the main screen for all assignment reveals!</p>
            </div>
          ` : `
            <div class="secret-card-wrapper">
              <div class="secret-card card-location ${this.isCardRevealed ? 'revealed' : 'hidden'}" id="cardToggle">
                ${this.isCardRevealed ? `
                  <div class="card-content">
                    <div class="card-badge">COVERT MISSION ASSIGNMENT</div>
                    <h1 class="card-title">${this.privateState?.targetAvatar || '🎯'} ${this.privateState?.targetName || 'Secret Target'}</h1>
                    <p class="card-desc" style="font-size:15px; margin-top:12px;">
                      Your Secret Objective:<br/>
                      <strong>"${this.privateState?.mission}"</strong>
                    </p>
                    <button class="btn-hide-curtain" id="btnCurtain" style="margin-top:16px;">🙈 Hide Target</button>
                  </div>
                ` : `
                  <div class="curtain-content">
                    <span class="eye-icon">🔒</span>
                    <h3>Target Hidden</h3>
                    <p>Tap to reveal your covert mission</p>
                  </div>
                `}
              </div>
            </div>
          `}
        </div>
      </div>
    `;

    document.getElementById('cardToggle')?.addEventListener('click', () => {
      this.isCardRevealed = !this.isCardRevealed;
      this.render();
    });
  }
}
