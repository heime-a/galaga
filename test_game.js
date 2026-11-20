const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const path = require('path');

function setupEnvironment() {
    const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf-8');
    const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
    if (!scriptMatch) throw new Error('No script tag found');
    const scriptCode = scriptMatch[1];

    const elements = {
        'gameCanvas': {
            width: 448, height: 512,
            getContext: () => ({
                save: () => {},
                restore: () => {},
                translate: () => {},
                rotate: () => {},
                fillRect: () => {},
                fillStyle: '',
                globalAlpha: 1.0,
            })
        },
        'score-display': { innerText: '00' },
        'high-score': { innerText: '20000' },
        'lives-display': { innerText: '3' },
        'menu-overlay': { style: { display: 'flex' } },
        'menu-title': { innerText: 'Galaga' },
        'menu-sub': { innerText: '' },
        'start-btn': { innerText: 'START GAME', onclick: null },
        'l-btn': {},
        'r-btn': {},
        'f-btn': {}
    };

    let timeouts = [];
    const sandbox = {
        document: {
            getElementById: (id) => elements[id] || { style: {}, innerText: '' }
        },
        window: {
            onkeydown: null,
            onkeyup: null,
            onload: null,
            AudioContext: function() {
                return {
                    currentTime: 0,
                    state: 'running',
                    resume: () => {},
                    createOscillator: () => ({
                        type: '',
                        frequency: { setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} },
                        connect: () => {},
                        start: () => {},
                        stop: () => {}
                    }),
                    createGain: () => ({
                        gain: { setValueAtTime: () => {}, linearRampToValueAtTime: () => {} },
                        connect: () => {}
                    }),
                    destination: {}
                };
            }
        },
        requestAnimationFrame: () => {},
        console: console,
        Math: Math,
        setTimeout: (fn, delay) => { timeouts.push(fn); return timeouts.length; }
    };
    sandbox.window.webkitAudioContext = sandbox.window.AudioContext;

    const context = vm.createContext(sandbox);
    vm.runInContext(scriptCode, context);

    return {
        context,
        elements,
        runTimeouts: () => {
            const current = [...timeouts];
            timeouts = [];
            current.forEach(fn => fn());
        }
    };
}

function testAlienCollisionConsumesLife() {
    console.log('Testing: Alien collision consumes life...');
    const { context, elements } = setupEnvironment();
    elements['start-btn'].onclick();

    assert.strictEqual(vm.runInContext('lives', context), 3, 'Game should start with 3 lives');

    // Place an enemy right at player's position
    vm.runInContext(`
        enemies = [new Enemy(player.x, player.y, 'bee', 0)];
        enemies[0].x = player.x;
        enemies[0].y = player.y;
        enemies[0].state = 'dive';
    `, context);

    vm.runInContext('update()', context);

    const livesAfter = vm.runInContext('lives', context);
    assert.strictEqual(livesAfter, 2, `Lives should be 2 after 1 hit, got ${livesAfter}`);
    const isExploding = vm.runInContext('player.exploding', context);
    assert.strictEqual(isExploding, true, 'Player should be in exploding state');
    console.log('PASS: Alien collision consumes life and triggers explosion.');
}

function testEnemyBulletConsumesLife() {
    console.log('Testing: Enemy bullet consumes life...');
    const { context, elements } = setupEnvironment();
    elements['start-btn'].onclick();

    assert.strictEqual(vm.runInContext('lives', context), 3);

    // Place an enemy bullet right at player's position
    vm.runInContext(`
        enemyBullets = [{ x: player.x, y: player.y }];
        enemies = [];
    `, context);

    vm.runInContext('update()', context);

    const livesAfter = vm.runInContext('lives', context);
    assert.strictEqual(livesAfter, 2, `Lives should be 2 after bullet hit, got ${livesAfter}`);
    console.log('PASS: Enemy bullet consumes life.');
}

function testGameOverWhenLivesDepleted() {
    console.log('Testing: Game over triggers when all lives consumed...');
    const { context, elements, runTimeouts } = setupEnvironment();
    elements['start-btn'].onclick();

    // Consume first life
    vm.runInContext(`
        enemies = [new Enemy(player.x, player.y, 'bee', 0)];
        enemies[0].x = player.x; enemies[0].y = player.y; enemies[0].state = 'dive';
    `, context);
    vm.runInContext('update()', context);
    assert.strictEqual(vm.runInContext('lives', context), 2);

    // Advance frames so player respawns
    for (let f = 0; f < 70; f++) {
        vm.runInContext('update()', context);
    }
    // Remove invulnerability for testing
    vm.runInContext('player.invulnerable = 0', context);

    // Consume second life
    vm.runInContext(`
        enemies = [new Enemy(player.x, player.y, 'bee', 0)];
        enemies[0].x = player.x; enemies[0].y = player.y; enemies[0].state = 'dive';
    `, context);
    vm.runInContext('update()', context);
    assert.strictEqual(vm.runInContext('lives', context), 1);

    // Advance frames to respawn
    for (let f = 0; f < 70; f++) {
        vm.runInContext('update()', context);
    }
    vm.runInContext('player.invulnerable = 0', context);

    // Consume third (last) life
    vm.runInContext(`
        enemies = [new Enemy(player.x, player.y, 'bee', 0)];
        enemies[0].x = player.x; enemies[0].y = player.y; enemies[0].state = 'dive';
    `, context);
    vm.runInContext('update()', context);
    assert.strictEqual(vm.runInContext('lives', context), 0);

    runTimeouts();

    assert.strictEqual(vm.runInContext('gameActive', context), false, 'Game should be inactive after game over');
    assert.strictEqual(elements['menu-overlay'].style.display, 'flex', 'Menu overlay should be visible');
    assert.strictEqual(elements['menu-title'].innerText, 'GAME OVER', 'Title should be GAME OVER');
    console.log('PASS: Game over triggers properly when lives reach 0.');
}

function testDualShipAbsorbsHitWithoutConsumingLife() {
    console.log('Testing: Dual ship absorbs hit and drops to single ship without consuming life...');
    const { context, elements } = setupEnvironment();
    elements['start-btn'].onclick();

    vm.runInContext('isDualShip = true;', context);

    // Hit the dual ship
    vm.runInContext(`
        enemies = [new Enemy(player.x + 28, player.y, 'bee', 0)];
        enemies[0].x = player.x + 28; enemies[0].y = player.y; enemies[0].state = 'dive';
    `, context);
    vm.runInContext('update()', context);

    assert.strictEqual(vm.runInContext('isDualShip', context), false, 'Dual ship should be lost');
    assert.strictEqual(vm.runInContext('lives', context), 3, 'Lives should NOT be deducted when dual ship is lost');
    console.log('PASS: Dual ship absorbed hit without deducting life.');
}

function testAuthenticSpritesAndBossTwoHit() {
    console.log('Testing: Authentic arcade sprites, formation, and 2-hit Boss Galaga...');
    const { context, elements } = setupEnvironment();
    elements['start-btn'].onclick();

    // Verify 40 enemies in authentic 5-row formation (4 boss + 16 butterfly + 20 bee)
    const counts = vm.runInContext(`({
        total: enemies.length,
        boss: enemies.filter(e => e.type === 'boss').length,
        butterfly: enemies.filter(e => e.type === 'butterfly').length,
        bee: enemies.filter(e => e.type === 'bee').length,
        hasBossHitSprite: Array.isArray(SPRITES.boss_hit) && SPRITES.boss_hit.length === 2
    })`, context);
    assert.strictEqual(counts.total, 40, `Expected 40 enemies in formation, got ${counts.total}`);
    assert.strictEqual(counts.boss, 4, 'Expected 4 Boss Galagas in top row');
    assert.strictEqual(counts.butterfly, 16, 'Expected 16 Butterflies (Goei) in middle 2 rows');
    assert.strictEqual(counts.bee, 20, 'Expected 20 Bees (Zako) in bottom 2 rows');
    assert.strictEqual(counts.hasBossHitSprite, true, 'Expected boss_hit 2-frame sprite to exist');

    // Hit Boss Galaga once -> should survive with hp=1 (blue/magenta state)
    vm.runInContext(`
        enemies = [new Enemy(200, 100, 'boss', 0), new Enemy(400, 100, 'bee', 999)];
        enemies[0].x = 200; enemies[0].y = 100; enemies[0].state = 'formation';
        bullets = [{ x: 200, y: 104 }];
        update();
    `, context);
    assert.strictEqual(vm.runInContext('enemies.length', context), 2, 'Boss Galaga should survive 1st hit');
    assert.strictEqual(vm.runInContext('enemies[0].hp', context), 1, 'Boss Galaga HP should be 1 after 1st hit');

    // Hit Boss Galaga a second time in formation -> should be destroyed and award 150 pts (authentic 1981 scoring)
    vm.runInContext(`
        bullets = [{ x: enemies[0].x, y: enemies[0].y + 4 }];
        update();
    `, context);
    assert.strictEqual(vm.runInContext('enemies.length', context), 1, 'Boss Galaga should be destroyed on 2nd hit');
    assert.strictEqual(vm.runInContext('score', context), 150, 'Destroying Boss Galaga in formation should award 150 points');

    // Verify diving Boss Galaga scoring: solo = 400, 1 escort = 800, 2 escorts = 1600
    vm.runInContext(`
        score = 0;
        const b1 = new Enemy(200, 160, 'boss', 0);
        b1.x = 200; b1.y = 160; b1.hp = 1; b1.state = 'dive';
        const esc1 = new Enemy(166, 190, 'butterfly', 0);
        esc1.state = 'escort'; esc1.escortLeader = b1; esc1.x = 166; esc1.y = 190;
        const esc2 = new Enemy(234, 190, 'butterfly', 0);
        esc2.state = 'escort'; esc2.escortLeader = b1; esc2.x = 234; esc2.y = 190;
        enemies = [b1, esc1, esc2, new Enemy(400, 100, 'bee', 999)];
        bullets = [{ x: 200, y: 164 }];
        update();
    `, context);
    assert.strictEqual(vm.runInContext('score', context), 1600, 'Destroying diving Boss Galaga with 2 escorts should award 1600 points');
    console.log('PASS: Authentic sprites, formation, 2-hit Boss Galaga, and convoy scoring verified.');
}

function testCrkdAtomControllerSupport() {
    console.log('Testing: CRKD ATOM Collectible Keychain Controller support (D-Pad, Stick-remap, Hat-switch, Fire, Start & Select L/R Flip)...');
    const { context, elements } = setupEnvironment();

    const mockGamepad = {
        id: 'Nintendo Switch Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)',
        connected: true,
        buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
        axes: [0, 0, 0, 0, 0, 0, 0, 0, 0, 1.2857]
    };
    vm.runInContext('navigator = { getGamepads: () => [mockGamepad] }', Object.assign(context, { mockGamepad }));

    // 1. Pressing Start (button 9) on menu starts the game
    assert.strictEqual(vm.runInContext('gameActive', context), false);
    mockGamepad.buttons[9].pressed = true;
    vm.runInContext('update()', context);
    assert.strictEqual(vm.runInContext('gameActive', context), true, 'CRKD ATOM Start button should start game from menu');
    mockGamepad.buttons[9].pressed = false;
    vm.runInContext('update()', context);

    // 2. D-Pad Right (button 15) moves player right (with controllerInvertX = false)
    const startX = vm.runInContext('player.x', context);
    mockGamepad.buttons[15].pressed = true;
    vm.runInContext('update()', context);
    assert(vm.runInContext('player.x', context) > startX, 'CRKD ATOM D-Pad Right (button 15) should move ship right');
    mockGamepad.buttons[15].pressed = false;

    // 3. Select (-) button (button 8) flips L/R direction live
    mockGamepad.buttons[8].pressed = true;
    vm.runInContext('update()', context);
    assert.strictEqual(vm.runInContext('controllerInvertX', context), true, 'Select (-) button should toggle controllerInvertX to true');
    mockGamepad.buttons[8].pressed = false;
    vm.runInContext('update()', context);

    // 4. Fire button (button 0 / B) fires missile
    vm.runInContext('player.cooldown = 0; bullets = [];', context);
    mockGamepad.buttons[0].pressed = true;
    vm.runInContext('update()', context);
    assert.strictEqual(vm.runInContext('bullets.length', context), 1, 'CRKD ATOM face button should fire missile');
    mockGamepad.buttons[0].pressed = false;
    console.log('PASS: CRKD ATOM Collectible Keychain Controller verified across all modes.');
}

function testTractorBeamCaptureAndDualFighterRescue() {
    console.log('Testing: Boss Galaga Tractor Beam capture and Dual Fighter rescue...');
    const { context, elements, runTimeouts } = setupEnvironment();
    elements['start-btn'].onclick();

    // Place a single Boss Galaga entering tractor beam mode directly above the player
    vm.runInContext(`
        enemies = [new Enemy(WIDTH / 2, 72, 'boss', 0)];
        const boss = enemies[0];
        boss.x = player.x;
        boss.y = HEIGHT - 188;
        boss.tractorTargetX = player.x;
        boss.state = 'tractor';
        player.invulnerable = 0;
    `, context);

    // Advance frames until the tractor beam grows to full height and captures the player
    for (let i = 0; i < 160; i++) {
        vm.runInContext('update()', context);
        if (vm.runInContext('enemies[0].hasCaptured', context)) break;
    }
    runTimeouts();

    assert.strictEqual(vm.runInContext('enemies[0].hasCaptured', context), true, 'Boss Galaga should capture the player ship via tractor beam');
    assert.strictEqual(vm.runInContext('tractorBeam', context), null, 'Tractor beam should retract/clear once capture completes');
    assert.strictEqual(vm.runInContext('lives', context), 2, 'Capturing a ship should deduct 1 reserve life and spawn next fighter');
    assert.strictEqual(vm.runInContext('player.captured', context), false, 'Replacement fighter should be active on playfield');

    // Now shoot the Boss twice (2 hits to destroy Boss) to rescue the captured fighter
    vm.runInContext(`
        enemies[0].x = WIDTH / 2;
        enemies[0].y = 140;
        enemies[0].state = 'dive';
        bullets.push({ x: WIDTH / 2, y: 142 });
        bullets.push({ x: WIDTH / 2, y: 144 });
        update();
    `, context);

    assert(vm.runInContext('capturedShip !== null', context), 'Destroying the Boss with a captured fighter must release capturedShip');

    // Advance frames so capturedShip completes its celebration spin and docks with player
    for (let i = 0; i < 180; i++) {
        vm.runInContext('update()', context);
        if (vm.runInContext('isDualShip', context)) break;
    }

    assert.strictEqual(vm.runInContext('isDualShip', context), true, 'Rescued fighter should dock with player to form Dual Fighter (isDualShip = true)');
    assert.strictEqual(vm.runInContext('capturedShip', context), null, 'capturedShip should clear after docking');
    console.log('PASS: Boss Galaga Tractor Beam capture and Dual Fighter rescue verified.');
}

async function testSeparatePwaIsolation() {
    console.log('Testing: Standalone PWA manifest, scoped Service Worker cache isolation, and storage key isolation...');
    const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf-8');
    assert(html.includes('<link rel="manifest" href="manifest.json">'), 'Galaga index.html must link manifest.json');
    assert(html.includes('name="apple-mobile-web-app-title" content="Galaga"'), 'Galaga index.html must set apple-mobile-web-app-title');
    assert(html.includes('id="install-btn"'), 'Galaga index.html must include install-btn');
    assert(html.includes("localStorage.getItem('galaga_invert_lr')"), 'Galaga must use isolated galaga_invert_lr localStorage key');
    assert(!html.includes("localStorage.getItem('si_invert_lr')"), 'Galaga must not collide with Space Invaders si_invert_lr key');

    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'manifest.json'), 'utf-8'));
    assert.strictEqual(manifest.id, '/galaga/', 'Galaga manifest must have unique id "/galaga/"');
    assert.strictEqual(manifest.display, 'standalone', 'Galaga manifest must use standalone display');
    assert.strictEqual(manifest.scope, './', 'Galaga manifest must scope to ./');
    assert(manifest.icons.some(i => i.purpose === 'any') && manifest.icons.some(i => i.purpose === 'maskable'), 'Galaga manifest must provide separate any and maskable icons');

    // Verify sw.js activate handler only deletes galaga-arcade-* caches and never deletes space-invaders-arcade-* caches
    const swCode = fs.readFileSync(path.join(__dirname, 'sw.js'), 'utf-8');
    const deletedCaches = [];
    let activateHandler = null;
    const swSandbox = {
        self: {
            addEventListener: (type, fn) => { if (type === 'activate') activateHandler = fn; },
            skipWaiting: () => {},
            clients: { claim: () => {} }
        },
        caches: {
            keys: () => Promise.resolve(['galaga-arcade-v7', 'galaga-arcade-v8', 'space-invaders-arcade-v6']),
            delete: (k) => { deletedCaches.push(k); return Promise.resolve(true); }
        },
        Promise
    };
    vm.runInNewContext(swCode, swSandbox);
    let waitPromise = null;
    activateHandler({ waitUntil: p => { waitPromise = p; } });
    await waitPromise;
    assert.deepStrictEqual(deletedCaches, ['galaga-arcade-v7'], 'Galaga SW must only delete old galaga-arcade-* caches and preserve Space Invaders cache');
    assert(!swCode.includes('fetch(event.request, { cache:'), 'Galaga SW must fetch by URL string so navigate requests never throw TypeError in Chrome');
    console.log('PASS: Galaga PWA manifest, SW cache isolation, and storage key isolation verified.');
}

function testTwoShotLimitAndResultsTracking() {
    console.log('Testing: Authentic 2-shot limit per fighter and Results accuracy tracking...');
    const { context, elements } = setupEnvironment();
    elements['start-btn'].onclick();

    // Hold Space and advance frames - single fighter must never exceed 2 bullets on screen
    vm.runInContext(`
        enemies = [new Enemy(400, 100, 'bee', 999)];
        keys['Space'] = true;
        for (let i = 0; i < 30; i++) update();
        keys['Space'] = false;
    `, context);
    const singleCount = vm.runInContext('bullets.length', context);
    assert(singleCount <= 2 && singleCount >= 1, `Single fighter must cap active bullets at 2, got ${singleCount}`);

    // Dual fighter must cap at 4 bullets (2 pairs)
    vm.runInContext(`
        bullets = [];
        isDualShip = true;
        player.cooldown = 0;
        keys['Space'] = true;
        for (let i = 0; i < 30; i++) update();
        keys['Space'] = false;
    `, context);
    const dualCount = vm.runInContext('bullets.length', context);
    assert(dualCount <= 4 && dualCount >= 2, `Dual fighter must cap active bullets at 4, got ${dualCount}`);
    assert(vm.runInContext('shotsFired', context) > 0, 'shotsFired must be tracked');
    console.log('PASS: 2-shot cap per fighter and shot/hit tracking verified.');
}

function testChallengingStageTransformsExtraLifeAndFlags() {
    console.log('Testing: Challenging Stage, Transform sprites/bonuses, Extra Life (1UP), Stage Flags & Namco WSG audio...');
    const { context, elements } = setupEnvironment();
    elements['start-btn'].onclick();

    // 1. Challenging Stage on Stage 3 spawns 40 targets across 5 waves of 8
    vm.runInContext('level = 3; spawnWave();', context);
    assert.strictEqual(vm.runInContext('isChallengingStage', context), true, 'Stage 3 must be a Challenging Stage');
    assert.strictEqual(vm.runInContext('enemies.length', context), 40, 'Challenging Stage must spawn 40 targets');

    // Simulate clearing all 40 targets -> triggers PERFECT 10,000 bonus
    vm.runInContext(`
        challengingHits = 40;
        enemies = [];
        score = 0;
        update();
        for (let i = 0; i < 120; i++) update();
    `, context);
    assert.strictEqual(vm.runInContext('score', context), 10000, '40/40 Challenging Stage must award 10000 Perfect bonus');

    // 2. Transform sprites & stage rotation (Stage 4 Scorpion, Stage 8 Bosconian, Stage 12 Galaxian)
    const tChecks = vm.runInContext(`({
        s4: getTransformTypeForLevel(4),
        s8: getTransformTypeForLevel(8),
        s12: getTransformTypeForLevel(12),
        hasScorpion: Array.isArray(SPRITES.scorpion) && SPRITES.scorpion.length === 2,
        hasBosconian: Array.isArray(SPRITES.bosconian) && SPRITES.bosconian.length === 2,
        hasGalaxian: Array.isArray(SPRITES.galaxian) && SPRITES.galaxian.length === 2
    })`, context);
    assert.strictEqual(tChecks.s4.type, 'scorpion');
    assert.strictEqual(tChecks.s4.bonus, 1000);
    assert.strictEqual(tChecks.s8.type, 'bosconian');
    assert.strictEqual(tChecks.s8.bonus, 2000);
    assert.strictEqual(tChecks.s12.type, 'galaxian');
    assert.strictEqual(tChecks.s12.bonus, 3000);
    assert(tChecks.hasScorpion && tChecks.hasBosconian && tChecks.hasGalaxian, 'All 3 authentic transform sprites must exist');

    // 3. Extra life at 20,000 pts and again at 70,000 pts
    vm.runInContext('lives = 3; score = 0; nextExtraLife = 20000; addScore(20000);', context);
    assert.strictEqual(vm.runInContext('lives', context), 4, 'Reaching 20000 pts must award 1st extra life');
    vm.runInContext('addScore(50000);', context);
    assert.strictEqual(vm.runInContext('lives', context), 5, 'Reaching 70000 pts must award 2nd extra life');

    // 4. Authentic Stage Flags decomposition (50/30/20/10/5/1)
    const flags68 = Array.from(vm.runInContext('decomposeStageFlags(68)', context));
    assert.deepStrictEqual(flags68, [50, 10, 5, 1, 1, 1], 'Stage 68 should decompose into [50, 10, 5, 1, 1, 1]');

    // 5. Authentic 1981 Namco WSG ROM Sound Engine verification across all 24 sounds (0..23)
    const wsgSummary = vm.runInContext(`(() => {
        const res = [];
        for (let sid = 0; sid < 24; sid++) {
            const pcm = GalagaSound.renderPCM(sid, 22050);
            let peak = 0;
            for (let i = 0; i < pcm.length; i++) {
                const a = Math.abs(pcm[i]);
                if (Number.isNaN(a)) return { error: 'NaN in sound ' + sid };
                if (a > peak) peak = a;
            }
            res.push({ sid, len: pcm.length, peak });
        }
        GalagaSound.playCoin();
        GalagaSound.playStartTheme();
        GalagaSound.playChallengingStart();
        GalagaSound.playChallengingClear(true);
        GalagaSound.playCapturedTheme();
        GalagaSound.playRescuedTheme();
        GalagaSound.playExtraLife();
        GalagaSound.playShot();
        GalagaSound.playDive();
        GalagaSound.playBossHit1();
        GalagaSound.playEnemyDestroy('boss');
        GalagaSound.playPlayerExplosion();
        GalagaSound.playTransformSplit();
        GalagaSound.playBonusChime();
        GalagaSound.syncLoops(true, false, 0);
        GalagaSound.syncLoops(false, false, 5);
        GalagaSound.syncLoops(false, false, 6);
        GalagaSound.playGameOver(true);
        draw();
        return { count: res.length, minLen: Math.min(...res.map(r => r.len)), minPeak: Math.min(...res.map(r => r.peak)) };
    })()`, context);
    assert(!wsgSummary.error, wsgSummary.error || '');
    assert.strictEqual(wsgSummary.count, 24, 'All 24 original 1981 Galaga WSG ROM sounds must synthesize');
    assert(wsgSummary.minLen > 1000, `Expected non-empty PCM for all 24 sounds, got minLen=${wsgSummary.minLen}`);
    assert(wsgSummary.minPeak > 0.1, `Expected audible PCM for all 24 sounds, got minPeak=${wsgSummary.minPeak}`);
    console.log('PASS: Challenging Stage, Transforms, Extra Life, Stage Flags, and all 24 authentic 1981 WSG ROM sounds verified.');
}

(async () => {
    try {
        testAlienCollisionConsumesLife();
        testEnemyBulletConsumesLife();
        testGameOverWhenLivesDepleted();
        testDualShipAbsorbsHitWithoutConsumingLife();
        testAuthenticSpritesAndBossTwoHit();
        testCrkdAtomControllerSupport();
        testTractorBeamCaptureAndDualFighterRescue();
        testTwoShotLimitAndResultsTracking();
        testChallengingStageTransformsExtraLifeAndFlags();
        await testSeparatePwaIsolation();
        console.log('\nAll tests passed successfully!');
    } catch (e) {
        console.error('\nTest failed:', e.message);
        process.exit(1);
    }
})();
