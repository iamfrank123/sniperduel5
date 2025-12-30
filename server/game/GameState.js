import { HitDetection } from './HitDetection.js';
import { GAME_CONSTANTS, PACKET_TYPES, MATCH_MODES, CLASSES, MATCH_STATUS } from '../../shared/constants.js';
import { Player } from './Player.js';
import { BotAI } from './BotAI.js';
import { MAP_GEOMETRY, checkMapCollision } from '../../shared/MapData.js';
export class GameState {
    constructor(matchId, inviteCode, io, settings = {}) {
        this.matchId = matchId;
        this.inviteCode = inviteCode;
        this.io = io;

        this.status = MATCH_STATUS.WAITING;
        this.players = new Map(); // playerId -> PlayerState

        // Settings
        this.roundsToWin = settings.rounds || GAME_CONSTANTS.ROUNDS_TO_WIN;
        this.autoRematch = settings.autoRematch || false;
        this.infiniteAmmo = settings.infiniteAmmo || false;
        this.movementSpeed = settings.movementSpeed || 1.0;
        this.jumpLevel = settings.jumpLevel || 1.0;
        this.roundTime = settings.roundTime || GAME_CONSTANTS.ROUND_TIME;

        // Bot Settings
        this.matchMode = settings.matchMode || 'PVP';
        this.botDifficulty = settings.botDifficulty || 'MEDIO';
        this.botCount = settings.botCount !== undefined ? settings.botCount : (this.matchMode.includes('BOT') ? 4 : 0);
        this.bots = []; // BotAI instances

        this.round = 1;
        this.scores = {}; // playerId -> score
        this.roundStartTime = 0;
        this.timeRemaining = GAME_CONSTANTS.ROUND_TIME;

        this.hitDetection = new HitDetection();
        this.stateHistory = []; // For lag compensation (max 20 snapshots, 500ms)
        this.previousState = {}; // For delta compression

        this.tickInterval = null;
    }

    addPlayer(playerId, socket, nickname, isBot = false, playerClass = 'SNIPER') {
        const spawnPosition = this.getSpawnPosition();

        const player = new Player(playerId, socket, nickname, spawnPosition);
        player.isBot = isBot;
        player.setClass(isBot ? 'SNIPER' : playerClass);

        // Apply initial settings
        if (this.infiniteAmmo) {
            player.ammo = 999;
            player.reserveAmmo = 999;
        }

        this.players.set(playerId, player);
        this.scores[playerId] = 0; // Initialize score
    }

    isFull() {
        return this.players.size >= GAME_CONSTANTS.MAX_PLAYERS;
    }

    isEmpty() {
        return this.players.size === 0;
    }

    startGame() {
        if (this.status !== MATCH_STATUS.WAITING) return;

        const minPlayers = this.matchMode === 'PVP' ? 2 : 1;
        if (this.players.size < minPlayers) return;

        console.log(`Starting game in ${this.matchMode} mode with ${this.botCount} bots.`);

        this.status = MATCH_STATUS.IN_PROGRESS;

        if (this.matchMode !== 'PVP' && this.botCount > 0) {
            this.initializeBots();
        }
        // Notify clients FIRST so they initialize the game
        this.io.to(this.matchId).emit('gameStart', {
            round: this.round,
            scores: this.scores,
            roundsToWin: this.roundsToWin
        });

        this.startRound();

        // Start game tick
        this.tickInterval = setInterval(() => this.tick(), GAME_CONSTANTS.TICK_INTERVAL);
    }

    startRound() {
        this.roundStartTime = Date.now();
        this.timeRemaining = this.roundTime;

        // Reset players
        for (const [playerId, player] of this.players) {
            player.health = GAME_CONSTANTS.MAX_HEALTH;

            const classStats = CLASSES[player.playerClass] || CLASSES.SNIPER;
            player.ammo = this.infiniteAmmo ? 999 : classStats.magazineSize;
            player.reserveAmmo = this.infiniteAmmo ? 999 : classStats.reserveAmmo;

            player.isDead = false;

            const spawnInfo = this.getSpawnPosition();
            player.position = { x: spawnInfo.x, y: spawnInfo.y, z: spawnInfo.z };
            player.rotation.yaw = spawnInfo.yaw || 0;
            player.rotation.pitch = 0;
        }

        // Notify clients
        const spawnData = {};
        for (const [playerId, player] of this.players) {
            spawnData[playerId] = {
                spawnPosition: player.position,
                spawnRotation: player.rotation
            };
        }

        const playersData = {};
        for (const [playerId, player] of this.players) {
            playersData[playerId] = {
                nickname: player.nickname
            };
        }

        this.io.to(this.matchId).emit('roundStart', {
            round: this.round,
            scores: this.scores,
            spawns: spawnData,
            players: playersData,
            roundsToWin: this.roundsToWin
        });
    }

    tick() {
        if (this.status !== MATCH_STATUS.IN_PROGRESS) return;

        // Update time
        const elapsed = (Date.now() - this.roundStartTime) / 1000;
        this.timeRemaining = Math.max(0, this.roundTime - elapsed);

        // Check time limit
        if (this.timeRemaining <= 0) {
            this.endRound('TIME_LIMIT', null);
            return;
        }

        // Update bots
        const deltaTime = GAME_CONSTANTS.TICK_INTERVAL / 1000;
        for (const bot of this.bots) {
            bot.update(deltaTime);
        }

        // Save state snapshot for lag compensation
        this.saveStateSnapshot();

        // Broadcast state update
        this.broadcastState();
    }

    saveStateSnapshot() {
        const snapshot = {
            timestamp: Date.now(),
            players: {}
        };

        for (const [playerId, player] of this.players) {
            snapshot.players[playerId] = {
                position: { ...player.position },
                rotation: { ...player.rotation },
                health: player.health
            };
        }

        this.stateHistory.push(snapshot);

        // MEMORY LEAK FIX: Dual protection - time-based AND count-based
        const cutoff = Date.now() - 500;
        this.stateHistory = this.stateHistory.filter(s => s.timestamp >= cutoff);

        // Hard limit: never exceed 20 snapshots
        if (this.stateHistory.length > 20) {
            this.stateHistory = this.stateHistory.slice(-20);
        }
    }

    broadcastState() {
        const stateUpdate = {
            round: this.round,
            scores: this.scores,
            timeRemaining: this.timeRemaining,
            roundsToWin: this.roundsToWin,
            players: {}
        };

        // NETWORK OPTIMIZATION: Delta compression - only send changed values
        const POSITION_TOLERANCE = 0.01;
        const ROTATION_TOLERANCE = 0.01;

        for (const [playerId, player] of this.players) {
            const prev = this.previousState[playerId];
            const playerUpdate = {};

            // Always send nickname and isBot on first update
            if (!prev) {
                playerUpdate.nickname = player.nickname;
                playerUpdate.isBot = player.isBot || false;
                playerUpdate.position = player.position;
                playerUpdate.rotation = player.rotation;
                playerUpdate.health = player.health;
                playerUpdate.isDead = player.isDead;
                playerUpdate.playerClass = player.playerClass;
            } else {
                // Only send position if changed significantly
                if (Math.abs(player.position.x - prev.position.x) > POSITION_TOLERANCE ||
                    Math.abs(player.position.y - prev.position.y) > POSITION_TOLERANCE ||
                    Math.abs(player.position.z - prev.position.z) > POSITION_TOLERANCE) {
                    playerUpdate.position = player.position;
                }

                // Only send rotation if changed significantly
                if (Math.abs(player.rotation.yaw - prev.rotation.yaw) > ROTATION_TOLERANCE ||
                    Math.abs(player.rotation.pitch - prev.rotation.pitch) > ROTATION_TOLERANCE) {
                    playerUpdate.rotation = player.rotation;
                }

                // Only send health if changed
                if (player.health !== prev.health) {
                    playerUpdate.health = player.health;
                }

                // Only send isDead if changed
                if (player.isDead !== prev.isDead) {
                    playerUpdate.isDead = player.isDead;
                }

                // Only send playerClass if changed
                if (player.playerClass !== prev.playerClass) {
                    playerUpdate.playerClass = player.playerClass;
                }

                // Always include nickname and isBot for new clients
                playerUpdate.nickname = player.nickname;
                playerUpdate.isBot = player.isBot || false;
            }

            stateUpdate.players[playerId] = playerUpdate;

            // Update previous state
            this.previousState[playerId] = {
                position: { ...player.position },
                rotation: { ...player.rotation },
                health: player.health,
                isDead: player.isDead,
                playerClass: player.playerClass
            };
        }

        // Clean up previous state for disconnected players
        for (const playerId in this.previousState) {
            if (!this.players.has(playerId)) {
                delete this.previousState[playerId];
            }
        }

        this.io.to(this.matchId).emit('stateUpdate', stateUpdate);
    }

    updatePlayerMovement(playerId, data) {
        const player = this.players.get(playerId);
        if (!player || player.isDead) return;

        // COLLISION RESOLUTION: Implement sliding instead of rejection
        const newPos = data.position;
        const oldPos = player.position;

        // Check if new position collides
        if (checkMapCollision(newPos, GAME_CONSTANTS.PLAYER_RADIUS * 0.9)) {
            // Try sliding along X axis
            const slideX = { x: newPos.x, y: newPos.y, z: oldPos.z };
            if (!checkMapCollision(slideX, GAME_CONSTANTS.PLAYER_RADIUS * 0.9)) {
                player.position = slideX;
                player.rotation = data.rotation;
                player.velocity = data.velocity;
                return;
            }

            // Try sliding along Z axis
            const slideZ = { x: oldPos.x, y: newPos.y, z: newPos.z };
            if (!checkMapCollision(slideZ, GAME_CONSTANTS.PLAYER_RADIUS * 0.9)) {
                player.position = slideZ;
                player.rotation = data.rotation;
                player.velocity = data.velocity;
                return;
            }

            // If both slides fail, keep old position but update rotation
            player.rotation = data.rotation;
            return;
        }

        // No collision, accept the movement
        player.position = data.position;
        player.rotation = data.rotation;
        player.velocity = data.velocity;
    }

    handlePlayerShoot(playerId, data) {
        const shooter = this.players.get(playerId);
        if (!shooter || shooter.isDead) {
            // console.log(`[Shoot Rejected] Player ${playerId} not found or dead`);
            return;
        }

        if (shooter.ammo <= 0 && !this.infiniteAmmo) {
            // console.log(`[Shoot Rejected] Player ${shooter.nickname} out of ammo (Server: ${shooter.ammo})`);
            return;
        }

        if (!this.infiniteAmmo) {
            shooter.ammo--;
        }

        // Notify clients that player fired (for sound/visuals)
        this.io.to(this.matchId).emit('playerFired', {
            shooterId: playerId
        });

        // Perform hit detection
        const hitResult = this.hitDetection.performRaycast(
            data.position,
            data.direction,
            this.players,
            playerId,
            data.timestamp,
            this.stateHistory
        );

        if (hitResult.hit) {
            const victim = this.players.get(hitResult.victimId);
            if (victim && !victim.isDead) {
                // Apply damage
                const damage = this.calculateDamage(hitResult.hitbox, shooter.playerClass);
                victim.health -= damage;

                const fatal = victim.health <= 0;
                if (fatal) {
                    victim.health = 0;
                    victim.isDead = true;

                    // Update score for the shooter
                    this.scores[shooter.id]++;

                    // Notify clients
                    this.io.to(this.matchId).emit('playerDied', {
                        victimId: hitResult.victimId,
                        killerId: playerId,
                        victimNickname: victim.nickname,
                        killerNickname: shooter.nickname,
                        hitbox: hitResult.hitbox
                    });

                    // Check win condition
                    if (this.scores[shooter.id] >= this.roundsToWin) {
                        this.endMatch(playerId);
                    } else {
                        // In infinite deathmatch, we just respawn the victim after a delay
                        // instead of ending the round.
                        setTimeout(() => {
                            if (!this.players.has(hitResult.victimId)) return; // Already disconnected

                            victim.health = GAME_CONSTANTS.MAX_HEALTH;
                            victim.isDead = false;
                            const spawn = this.getSpawnPosition();
                            victim.position = { x: spawn.x, y: spawn.y, z: spawn.z };
                            victim.rotation = { yaw: spawn.yaw, pitch: 0 };

                            // Emit respawn event
                            this.io.to(this.matchId).emit('playerRespawn', {
                                playerId: hitResult.victimId,
                                position: victim.position,
                                rotation: victim.rotation
                            });
                        }, GAME_CONSTANTS.RESPAWN_TIME * 1000);
                    }
                }

                // Notify clients of hit
                this.io.to(this.matchId).emit('hitConfirmed', {
                    shooterId: playerId,
                    victimId: hitResult.victimId,
                    shooterNickname: shooter.nickname,
                    victimNickname: victim.nickname,
                    hitbox: hitResult.hitbox,
                    damage,
                    fatal,
                    impactPoint: hitResult.impactPoint,
                    isShooterBot: shooter.isBot || false
                });
            }
        }
    }

    processShot(playerId, data) {
        const shooter = this.players.get(playerId);
        if (!shooter || shooter.isDead) return;

        // Check ammo/reload state... (omitted for brevity, handled in client mostly but good to verify)

        // Perform raycast
        // We need to pass the state history to the hit detection
        // to find where players were at 'data.timestamp'
        const hitResult = this.hitDetection.performRaycast(
            data.origin,
            data.direction,
            this.players,
            playerId,
            data.timestamp,
            this.stateHistory
        );

        if (hitResult.hit) {
            const victim = this.players.get(hitResult.victimId);
            if (victim) {
                // Calculate damage based on class
                const damage = this.calculateDamage(hitResult.hitbox, shooter.playerClass);
                const fatal = victim.takeDamage(damage);

                if (fatal) {
                    shooter.kills++;
                    victim.deaths++;

                    // Broadcast death
                    this.io.emit(PACKET_TYPES.PLAYER_DIED, {
                        shooterId: playerId,
                        victimId: hitResult.victimId,
                        shooterNickname: shooter.nickname,
                        victimNickname: victim.nickname, // Fixed typo from 'victom'
                        hitbox: hitResult.hitbox,
                        damage,
                        fatal,
                        impactPoint: hitResult.impactPoint,
                        isShooterBot: shooter.isBot || false
                    });

                    // Start respawn timer
                    setTimeout(() => {
                        this.respawnPlayer(hitResult.victimId);
                    }, GAME_CONSTANTS.RESPAWN_TIME * 1000);
                } else {
                    // Update victim state immediately in next broadcast
                }

                // Confirm hit to shooter
                const shooterSocket = this.io.sockets.sockets.get(playerId);
                if (shooterSocket) {
                    shooterSocket.emit(PACKET_TYPES.HIT_CONFIRMED, {
                        victimId: hitResult.victimId,
                        damage: damage,
                        fatal: fatal,
                        hitbox: hitResult.hitbox
                    });
                }
            }
        }
    }

    calculateDamage(hitbox, playerClassId) {
        // Default to SNIPER if class invalid
        const classStats = CLASSES[playerClassId] || CLASSES.SNIPER;
        const damageStats = classStats.damage;

        switch (hitbox) {
            case 'HEAD':
                return damageStats.head;
            case 'UPPER_BODY':
            case 'LOWER_BODY':
                return damageStats.body;
            case 'LEFT_ARM':
            case 'RIGHT_ARM':
            case 'LEFT_LEG':
            case 'RIGHT_LEG':
                // Limb damage usually lower, let's say 2/3 of body or same as body?
                // Guide only specified Body and Head. 
                // Let's use Body damage for limbs or slightly less.
                // Current code had LIMB_DAMAGE = 50 vs BODY = 75 (0.66 ratio).
                return Math.floor(damageStats.body * 0.7);
            default:
                return Math.floor(damageStats.body * 0.5);
        }
    }

    handlePlayerReload(playerId) {
        const player = this.players.get(playerId);
        if (!player || player.isDead) return;

        const classStats = CLASSES[player.playerClass] || CLASSES.SNIPER;
        const ammoNeeded = classStats.magazineSize - player.ammo;

        if (ammoNeeded <= 0) return;

        const ammoToTake = this.infiniteAmmo ? ammoNeeded : Math.min(ammoNeeded, player.reserveAmmo);

        player.ammo += ammoToTake;
        if (!this.infiniteAmmo) {
            player.reserveAmmo -= ammoToTake;
        }
    }

    handleScopeToggle(playerId, scoped) {
        const player = this.players.get(playerId);
        if (!player) return;

        player.isScoped = scoped;
    }

    updateSettings(settings) {
        if (settings.rounds !== undefined) this.roundsToWin = settings.rounds;
        if (settings.autoRematch !== undefined) this.autoRematch = settings.autoRematch;
        if (settings.infiniteAmmo !== undefined) {
            this.infiniteAmmo = settings.infiniteAmmo;
            if (this.infiniteAmmo) {
                for (const player of this.players.values()) {
                    player.ammo = 999;
                    player.reserveAmmo = 999;
                }
            }
        }
    }

    handleClassSwitch(playerId, classId) {
        const player = this.players.get(playerId);
        if (!player || player.isDead) return;

        if (!CLASSES[classId]) return;

        player.setClass(classId);

        // Reset ammo based on new class
        const classStats = CLASSES[classId];
        player.ammo = this.infiniteAmmo ? 999 : classStats.magazineSize;
        player.reserveAmmo = this.infiniteAmmo ? 999 : classStats.reserveAmmo;

        this.io.to(this.matchId).emit('playerClassSwitched', {
            playerId,
            classId,
            nickname: player.nickname
        });

        this.broadcastState();
    }

    updateSettings(settings) {
        if (settings.movementSpeed !== undefined) this.movementSpeed = settings.movementSpeed;
        if (settings.jumpLevel !== undefined) this.jumpLevel = settings.jumpLevel;

        if (settings.matchMode !== undefined) this.matchMode = settings.matchMode;
        if (settings.botDifficulty !== undefined) this.botDifficulty = settings.botDifficulty;
        if (settings.botCount !== undefined) this.botCount = settings.botCount;

        // BUG FIX: Only update matchMode from botMode if we are NOT in PVP mode
        // This prevents "Create Match" (PVP) from being hijacked by default bot settings
        if (settings.botMode !== undefined && this.matchMode !== 'PVP') {
            this.matchMode = settings.botMode;
        }
        if (settings.roundTime !== undefined) this.roundTime = settings.roundTime;

        // Broadcast update to all players
        this.io.to(this.matchId).emit('settingsUpdated', {
            settings: {
                rounds: this.roundsToWin,
                autoRematch: this.autoRematch,
                infiniteAmmo: this.infiniteAmmo,
                movementSpeed: this.movementSpeed,
                jumpLevel: this.jumpLevel,
                roundTime: this.roundTime,
                matchMode: this.matchMode,
                botDifficulty: this.botDifficulty,
                botCount: this.botCount
            }
        });
    }

    handleRematchRequest(playerId) {
        const player = this.players.get(playerId);
        // Only accept rematch if match ended
        if (!player || this.status !== MATCH_STATUS.MATCH_END) return;

        player.wantsRematch = true;

        // Check if all players want rematch
        let allWantRematch = true;
        for (const [id, p] of this.players) {
            if (!p.wantsRematch) {
                allWantRematch = false;
                break;
            }
        }

        if (allWantRematch && this.players.size > 0) {
            this.resetMatch();
        }
    }

    resetMatch() {
        this.status = MATCH_STATUS.WAITING;
        this.round = 1;
        this.timeRemaining = this.roundTime;

        // Reset players and scores
        for (const [id, p] of this.players) {
            this.scores[id] = 0;
            p.reset(this.infiniteAmmo);
        }

        // Notify clients
        this.io.to(this.matchId).emit('matchReset', {
            round: this.round,
            scores: this.scores,
            roundsToWin: this.roundsToWin
        });

        // Start game immediately
        this.startGame();
    }

    endRound(reason, winnerId) {
        this.status = MATCH_STATUS.ROUND_END;

        this.io.to(this.matchId).emit('roundEnd', {
            reason,
            winnerId,
            scores: this.scores
        });

        // Start next round after delay
        setTimeout(() => {
            this.round++;
            this.status = MATCH_STATUS.IN_PROGRESS;
            this.startRound();
        }, GAME_CONSTANTS.RESPAWN_TIME * 1000);
    }

    endMatch(winnerId) {
        this.status = MATCH_STATUS.MATCH_END;

        if (this.tickInterval) {
            clearInterval(this.tickInterval);
            this.tickInterval = null;
        }

        this.io.to(this.matchId).emit('matchEnd', {
            winnerId,
            scores: this.scores
        });

        // AUTO REMATCH logic
        if (this.autoRematch) {
            setTimeout(() => {
                if (this.status === MATCH_STATUS.MATCH_END) {
                    this.resetMatch();
                }
            }, GAME_CONSTANTS.RESPAWN_TIME * 1000);
        }
    }

    handlePlayerDisconnect(playerId) {
        this.players.delete(playerId);
        delete this.scores[playerId];

        // End match if fewer than 2 players remain and match was in progress
        if (this.status === MATCH_STATUS.IN_PROGRESS && this.players.size < 1) {
            if (this.tickInterval) {
                clearInterval(this.tickInterval);
                this.tickInterval = null;
            }
        }
    }

    getSpawnPosition() {
        // Use predefined "hidden" spawn points from MapData
        const points = MAP_GEOMETRY.SPAWN_POINTS;
        const randomPoint = points[Math.floor(Math.random() * points.length)];

        return { ...randomPoint };
    }

    getSpawnPoints() {
        return MAP_GEOMETRY.SPAWN_POINTS;
    }

    initializeBots() {
        const botCount = Math.min(this.botCount, GAME_CONSTANTS.MAX_PLAYERS - this.players.size);
        console.log(`Initializing ${botCount} bots...`);
        for (let i = 0; i < botCount; i++) {
            const botId = `bot_${i + 1}`;
            const nickname = `bot${i + 1}`;
            const spawnPosition = this.getSpawnPosition();

            const bot = new Player(botId, null, nickname, spawnPosition);
            bot.isBot = true;
            bot.setClass('SNIPER'); // Bots are always Snipers for now

            // Apply initial settings
            if (this.infiniteAmmo) {
                bot.ammo = 999;
                bot.reserveAmmo = 999;
            }

            this.players.set(botId, bot);
            this.scores[botId] = 0;

            const botAI = new BotAI(bot, this);
            this.bots.push(botAI);
        }
    }
}
