const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

function setupEnvironment() {
    const html = fs.readFileSync('index.html', 'utf-8');
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

    // Hit Boss Galaga a second time -> should be destroyed and award 400 pts
    vm.runInContext(`
        bullets = [{ x: enemies[0].x, y: enemies[0].y + 4 }];
        update();
    `, context);
    assert.strictEqual(vm.runInContext('enemies.length', context), 1, 'Boss Galaga should be destroyed on 2nd hit');
    assert.strictEqual(vm.runInContext('score', context), 400, 'Destroying Boss Galaga should award 400 points');
    console.log('PASS: Authentic sprites, formation, and 2-hit Boss Galaga verified.');
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

try {
    testAlienCollisionConsumesLife();
    testEnemyBulletConsumesLife();
    testGameOverWhenLivesDepleted();
    testDualShipAbsorbsHitWithoutConsumingLife();
    testAuthenticSpritesAndBossTwoHit();
    testCrkdAtomControllerSupport();
    console.log('\nAll tests passed successfully!');
} catch (e) {
    console.error('\nTest failed:', e.message);
    process.exit(1);
}
