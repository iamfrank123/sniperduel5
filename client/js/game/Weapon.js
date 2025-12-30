// Weapon - Sniper rifle mechanics
import * as THREE from 'three';
import { GAME_CONSTANTS, WEAPON_STATES, CLASSES } from '../../../shared/constants.js';

export class Weapon {
    constructor(player, scene, network, ui, audioManager) {
        this.player = player;
        this.scene = scene;
        this.network = network;
        this.ui = ui;
        this.audioManager = audioManager;

        this.state = WEAPON_STATES.IDLE;
        this.currentAmmo = GAME_CONSTANTS.MAGAZINE_SIZE;
        this.reserveAmmo = GAME_CONSTANTS.RESERVE_AMMO;
        this.infiniteAmmo = false;
        this.isScoped = false;

        this.lastShotTime = 0;
        this.boltActionStartTime = 0;
        this.reloadStartTime = 0;

        this.targetFOV = GAME_CONSTANTS.DEFAULT_FOV;
        this.currentFOV = GAME_CONSTANTS.DEFAULT_FOV;

        this.stats = CLASSES.SNIPER; // Default
        this.nextShotTime = 0; // For fire rate limit

        this.updateUI();
    }

    setStats(classId) {
        if (!CLASSES[classId]) return;
        this.stats = CLASSES[classId];

        // Reset ammo to new max
        this.currentAmmo = this.stats.magazineSize;
        this.reserveAmmo = this.stats.reserveAmmo;

        // Update UI
        this.updateUI();
        console.log(`Weapon stats updated to: ${classId}`);
    }

    update(deltaTime) {
        // Handle input
        this.handleInput();

        // Update state machine
        this.updateState(deltaTime);

        // Update FOV transition (smooth scope)
        this.updateFOV(deltaTime);
    }

    handleInput() {
        const input = this.player.input;
        const now = Date.now();

        switch (this.state) {
            case WEAPON_STATES.IDLE:
            case WEAPON_STATES.AIMING:
            case WEAPON_STATES.FIRING: // Allow firing state to continue for auto
                // Scope toggle (Right Click)
                // Only allow scope if not reloading
                if (input.isMouseRightDown() && !this.isScoped && this.state !== WEAPON_STATES.RELOADING) {
                    this.enterScope();
                } else if (!input.isMouseRightDown() && this.isScoped) {
                    this.exitScope();
                }

                // Shooting Logic
                const isFiring = input.isMouseLeftDown();
                const canShoot = now >= this.nextShotTime && this.currentAmmo > 0 && this.state !== WEAPON_STATES.RELOADING;

                if (isFiring) {
                    if (this.stats.isAutomatic) {
                        if (canShoot) {
                            this.shoot();
                        }
                    } else {
                        // Manual / Bolt Action
                        // For manual, we need to ensure they pressed it newly or we implement semi-auto check
                        // For now simple rate limit works for semi
                        if (canShoot && this.state !== WEAPON_STATES.FIRING && this.state !== WEAPON_STATES.BOLT_ACTION) {
                            this.shoot();
                        }
                    }
                }

                // Reload
                if (input.isReloadPressed() && this.currentAmmo < this.stats.magazineSize) {
                    this.startReload();
                }
                break;
        }
    }

    updateState(deltaTime) {
        const now = Date.now();

        switch (this.state) {
            case WEAPON_STATES.BOLT_ACTION:
                // Only for SNIPER or slow weapons
                const boltElapsed = (now - this.boltActionStartTime) / 1000;
                if (boltElapsed >= GAME_CONSTANTS.BOLT_ACTION_TIME) { // Keep fixed bolt time or make it dependent on fireRate?
                    // Actually fireRate for sniper is 1.5s (1500ms) which is bolt action time
                    // Let's rely on fireRate for shooting block, but state for animation/visuals
                    this.state = this.isScoped ? WEAPON_STATES.AIMING : WEAPON_STATES.IDLE;
                }
                break;

            case WEAPON_STATES.RELOADING:
                const reloadElapsed = (now - this.reloadStartTime) / 1000;
                if (reloadElapsed >= this.stats.reloadTime) {
                    this.completeReload();
                }
                break;

            case WEAPON_STATES.FIRING:
                // Return to idle/aiming after a short delay if not auto firing
                if (now > this.nextShotTime && !this.player.input.isMouseLeftDown()) {
                    this.state = this.isScoped ? WEAPON_STATES.AIMING : WEAPON_STATES.IDLE;
                }
                break;
        }
    }

    updateFOV(deltaTime) {
        // Smooth FOV transition
        const speed = GAME_CONSTANTS.FOV_TRANSITION_SPEED;
        this.currentFOV += (this.targetFOV - this.currentFOV) * speed * deltaTime;
        this.player.camera.fov = this.currentFOV;
        this.player.camera.updateProjectionMatrix();
    }

    shoot() {
        if (this.currentAmmo <= 0 && !this.infiniteAmmo) {
            // Dry fire sound
            return;
        }

        // Update firing rate limit
        this.nextShotTime = Date.now() + this.stats.fireRate;
        this.lastShotTime = Date.now();

        // Change state
        this.state = WEAPON_STATES.FIRING;

        if (!this.infiniteAmmo) {
            this.currentAmmo--;
        }

        this.updateUI();

        // Calculate accuracy
        const accuracy = this.calculateAccuracy();

        // Get ray direction from camera
        const direction = new THREE.Vector3(0, 0, -1);
        direction.applyQuaternion(this.player.camera.quaternion);

        // Apply spread
        const spreadDirection = this.applySpread(direction, accuracy);

        // Visual effects
        this.playMuzzleFlash();
        this.createBulletTracer(spreadDirection);
        this.applyCameraRecoil();

        // Play sound
        if (this.audioManager) {
            this.audioManager.playShot();
        }

        // Send to server
        this.network.sendShoot({
            position: {
                x: this.player.camera.position.x,
                y: this.player.camera.position.y,
                z: this.player.camera.position.z
            },
            direction: {
                x: spreadDirection.x,
                y: spreadDirection.y,
                z: spreadDirection.z
            },
            accuracy: accuracy
        });

        // If bolt action (really slow fire rate), trigger bolt action state
        if (!this.stats.isAutomatic && this.stats.fireRate >= 1000) {
            // Exit scope immediately for huge recoil/bolt action feels
            this.exitScope();
            this.boltActionStartTime = Date.now();
            this.state = WEAPON_STATES.BOLT_ACTION;
        }
    }

    calculateAccuracy() {
        if (this.isScoped) {
            return 1.0; // Perfect accuracy when scoped
        }

        let accuracy = 1.0 - this.stats.spread; // Base accuracy from stats

        if (this.player.isCrouching) {
            accuracy += 0.05;
        }

        // Moving penalty for hip-fire
        const speed = Math.sqrt(
            this.player.velocity.x ** 2 + this.player.velocity.z ** 2
        );
        if (speed > 0.5) {
            accuracy *= GAME_CONSTANTS.MOVING_PENALTY;
        }

        // Jumping penalty for hip-fire
        if (!this.player.isGrounded) {
            accuracy = GAME_CONSTANTS.JUMPING_ACCURACY;
        }

        return Math.max(0, Math.min(1, accuracy));
    }

    applySpread(direction, accuracy) {
        const maxSpread = GAME_CONSTANTS.MAX_SPREAD_ANGLE * (Math.PI / 180);
        // Stats spread is handled in calculateAccuracy as base, here we apply modifier
        // Actually, let's look at calculateAccuracy. It returns 0-1. 
        // 1 = perfect, 0 = max spread.

        const spreadFactor = (1.0 - accuracy); // 0 if perfect
        const spread = maxSpread * spreadFactor;

        // Random spread in cone
        const randomX = (Math.random() - 0.5) * spread;
        const randomY = (Math.random() - 0.5) * spread;

        const spreadDir = direction.clone();

        // Apply rotation
        const euler = new THREE.Euler(randomY, randomX, 0, 'YXZ');
        spreadDir.applyEuler(euler);
        spreadDir.normalize();

        return spreadDir;
    }

    playMuzzleFlash() {
        // TODO: Particle system for muzzle flash
    }

    createBulletTracer(direction) {
        // Create visual bullet tracer
        const start = this.player.camera.position.clone();
        // Removed offset to ensure visual accuracy matches server raycast (Eye level)
        // start.y -= 0.1;

        const end = start.clone().addScaledVector(direction, 100);

        const geometry = new THREE.BufferGeometry().setFromPoints([start, end]);
        const material = new THREE.LineBasicMaterial({
            color: 0xffaa00,
            transparent: true,
            opacity: 0.8
        });
        const line = new THREE.Line(geometry, material);
        this.scene.add(line);

        // Fade out and remove
        setTimeout(() => {
            let opacity = 0.8;
            const fadeInterval = setInterval(() => {
                opacity -= 0.1;
                material.opacity = opacity;
                if (opacity <= 0) {
                    clearInterval(fadeInterval);
                    this.scene.remove(line);
                    geometry.dispose();
                    material.dispose();
                }
            }, 30);
        }, 50); // Faster fade for auto weapons
    }

    applyCameraRecoil() {
        // Use recoil from stats
        this.player.rotation.pitch += this.stats.recoil;
    }

    enterScope() {
        this.isScoped = true;
        this.state = WEAPON_STATES.AIMING;
        this.targetFOV = this.stats.scopeZoom; // Use class specific zoom
        this.ui.showScope(true);
        this.network.sendScopeToggle(true);
    }

    exitScope() {
        this.isScoped = false;
        this.state = WEAPON_STATES.IDLE;
        this.targetFOV = GAME_CONSTANTS.DEFAULT_FOV;
        this.ui.showScope(false);
        this.network.sendScopeToggle(false);
    }

    startReload() {
        if (this.reserveAmmo === 0) {
            return;
        }

        this.state = WEAPON_STATES.RELOADING;
        this.reloadStartTime = Date.now();
        this.network.sendReload();
        // TODO: Play reload animation and sound
    }

    completeReload() {
        const ammoNeeded = this.stats.magazineSize - this.currentAmmo;
        const ammoToTake = Math.min(ammoNeeded, this.reserveAmmo);

        this.currentAmmo += ammoToTake;
        this.reserveAmmo -= ammoToTake;

        this.state = WEAPON_STATES.IDLE;
        this.updateUI();
    }

    updateUI() {
        this.ui.updateAmmo(this.currentAmmo, this.reserveAmmo, this.infiniteAmmo);
    }

    reset() {
        this.state = WEAPON_STATES.IDLE;
        this.currentAmmo = this.stats.magazineSize;
        this.reserveAmmo = this.stats.reserveAmmo;
        // Don't reset infiniteAmmo here, it's controlled by room settings
        this.isScoped = false;
        this.targetFOV = GAME_CONSTANTS.DEFAULT_FOV;
        this.currentFOV = GAME_CONSTANTS.DEFAULT_FOV;
        this.updateUI();
        this.ui.showScope(false);
    }
}
