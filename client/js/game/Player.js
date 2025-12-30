// Player - First-person player controller
import * as THREE from 'three';
import { Weapon } from './Weapon.js';
import { GAME_CONSTANTS, CLASSES } from '../../../shared/constants.js';
import { checkMapCollision } from '../../../shared/MapData.js';
import { MovementController } from './MovementController.js';

export class Player {
    constructor(scene, camera, input, network, ui, audioManager) {
        this.scene = scene;
        this.camera = camera;
        this.input = input;
        this.network = network;
        this.ui = ui;
        this.audioManager = audioManager;

        // Controller for advanced movement
        this.movementController = new MovementController(input);

        this.position = new THREE.Vector3(0, 0, 0);
        this.velocity = new THREE.Vector3(0, 0, 0);
        this.rotation = { pitch: 0, yaw: 0 };

        this.health = GAME_CONSTANTS.MAX_HEALTH;
        this.isGrounded = false;
        this.isCrouching = false;
        this.isDead = false;

        this.playerClass = CLASSES.SNIPER.id; // Default class

        this.settings = {
            movementSpeed: 1.0,
            jumpLevel: 1.0,
            infiniteAmmo: false
        };

        this.weapon = new Weapon(this, scene, network, ui, audioManager);

        this.lastNetworkUpdate = 0;
        this.networkUpdateInterval = 1000 / 30; // 30Hz

        // Mouse sensitivity (can be modified by pause menu)
        this.mouseSensitivity = 1.0;
    }

    update(deltaTime) {
        if (this.isDead) return;

        // Update camera rotation (mouse look)
        this.updateRotation(deltaTime);

        // Update movement
        this.updateMovement(deltaTime);

        // Update weapon
        this.weapon.update(deltaTime);

        // Send network update
        this.sendNetworkUpdate();
    }

    updateRotation(deltaTime) {
        const mouseDelta = this.input.getMouseDelta();
        const sensitivity = GAME_CONSTANTS.DEFAULT_SENSITIVITY * this.mouseSensitivity;

        this.rotation.yaw -= mouseDelta.x * sensitivity;
        this.rotation.pitch -= mouseDelta.y * sensitivity;

        // Clamp pitch
        this.rotation.pitch = Math.max(
            GAME_CONSTANTS.PITCH_MIN * Math.PI / 180,
            Math.min(GAME_CONSTANTS.PITCH_MAX * Math.PI / 180, this.rotation.pitch)
        );

        // Apply rotation to camera
        this.camera.rotation.order = 'YXZ';
        this.camera.rotation.y = this.rotation.yaw;
        this.camera.rotation.x = this.rotation.pitch;
    }

    updateMovement(deltaTime) {
        // Update Movement Controller (Handle states: Sprint, SuperSprint, Slide)
        this.movementController.update(deltaTime);

        // Get input
        const moveInput = this.input.getMovementInput();
        this.isCrouching = this.input.isCrouchPressed();

        // Calculate movement direction (camera-relative)
        const forward = new THREE.Vector3(0, 0, -1);
        const right = new THREE.Vector3(1, 0, 0);

        forward.applyQuaternion(this.camera.quaternion);
        right.applyQuaternion(this.camera.quaternion);

        // Flatten to horizontal plane
        forward.y = 0;
        right.y = 0;
        forward.normalize();
        right.normalize();

        // Calculate move direction
        const moveDirection = new THREE.Vector3();
        moveDirection.addScaledVector(forward, -moveInput.z);
        moveDirection.addScaledVector(right, moveInput.x);

        // Calculate speed using Controller
        const speedModifier = this.movementController.getSpeedModifier();

        // Base walk speed modified by settings AND controller state
        let speed = GAME_CONSTANTS.WALK_SPEED * this.settings.movementSpeed * speedModifier;

        // Crouch override (Crouch slows down unless Sliding)
        const isSliding = this.movementController.getState() === 'SLIDE';
        if (this.isCrouching && !isSliding) {
            speed = GAME_CONSTANTS.CROUCH_SPEED;
        }

        // Apply movement
        if (moveDirection.lengthSq() > 0) {
            moveDirection.normalize();

            // Allow full speed in details, acceleration could be added here
            this.velocity.x = moveDirection.x * speed;
            this.velocity.z = moveDirection.z * speed;
        } else {
            this.velocity.x = 0;
            this.velocity.z = 0;
        }

        // Apply gravity
        this.velocity.y -= GAME_CONSTANTS.GRAVITY * deltaTime;

        // Jump
        if (this.isGrounded && this.input.isJumpPressed() && !isSliding) { // Cannot jump while sliding
            this.velocity.y = GAME_CONSTANTS.JUMP_VELOCITY * this.settings.jumpLevel;
            this.isGrounded = false;
        }

        // Update position with collision detection
        const nextPos = this.position.clone().addScaledVector(this.velocity, deltaTime);

        // Safety: If already in collision, try pushing out slightly
        if (checkMapCollision(this.position, GAME_CONSTANTS.PLAYER_RADIUS)) {
            if (this.velocity.lengthSq() > 0.001) {
                const pushOut = this.velocity.clone().normalize().multiplyScalar(-0.2); // Stronger push
                this.position.add(pushOut);
            } else {
                // If stuck with no velocity, push towards center slightly
                const toCenter = new THREE.Vector3().sub(this.position).normalize().multiplyScalar(0.05);
                this.position.add(toCenter);
            }
            // NO RETURN HERE - Allow the movement code below to attempt to reach a valid state
        }

        // Separate movement into X and Z to allow for corner sliding
        const nextX = new THREE.Vector3(nextPos.x, this.position.y, this.position.z);
        if (!checkMapCollision(nextX, GAME_CONSTANTS.PLAYER_RADIUS)) {
            this.position.x = nextPos.x;
        }

        const nextZ = new THREE.Vector3(this.position.x, this.position.y, nextPos.z);
        if (!checkMapCollision(nextZ, GAME_CONSTANTS.PLAYER_RADIUS)) {
            this.position.z = nextPos.z;
        }

        // Vertical movement
        this.position.y += this.velocity.y * deltaTime;

        // Ground check
        if (this.position.y <= 0) {
            this.position.y = 0;
            this.velocity.y = 0;
            this.isGrounded = true;
        } else {
            this.isGrounded = false;
        }

        // Apply position to camera
        const eyeHeight = this.isCrouching ? 1.2 : GAME_CONSTANTS.EYE_HEIGHT;
        this.camera.position.copy(this.position);
        this.camera.position.y += eyeHeight;
    }

    sendNetworkUpdate() {
        const now = Date.now();
        if (now - this.lastNetworkUpdate >= this.networkUpdateInterval) {
            this.network.sendMovement({
                position: {
                    x: this.position.x,
                    y: this.position.y,
                    z: this.position.z
                },
                rotation: {
                    pitch: this.rotation.pitch,
                    yaw: this.rotation.yaw
                },
                velocity: {
                    x: this.velocity.x,
                    y: this.velocity.y,
                    z: this.velocity.z
                },
                grounded: this.isGrounded,
                crouching: this.isCrouching
            });

            this.lastNetworkUpdate = now;
        }
    }

    applySettings(settings) {
        this.settings = { ...this.settings, ...settings };
        if (this.weapon) {
            this.weapon.infiniteAmmo = this.settings.infiniteAmmo;
            if (this.settings.infiniteAmmo) {
                this.weapon.currentAmmo = 999;
                this.weapon.reserveAmmo = 999;
            }
            this.weapon.updateUI();
        }
    }

    takeDamage(damage) {
        this.health -= damage;
        this.ui.updateHealth(this.health);

        if (this.health <= 0) {
            this.die();
        }
    }

    die() {
        this.isDead = true;
        this.health = 0;
        this.ui.updateHealth(0);
        // TODO: Death camera, spectator mode
    }

    respawn(spawnPosition, spawnRotation) {
        this.isDead = false;
        this.health = GAME_CONSTANTS.MAX_HEALTH;
        this.ui.updateHealth(this.health);

        if (spawnPosition) {
            console.log("Player: Setting position to", spawnPosition);
            this.position.set(spawnPosition.x, spawnPosition.y, spawnPosition.z);
        }

        if (spawnRotation) {
            this.rotation.yaw = spawnRotation.yaw;
            this.rotation.pitch = spawnRotation.pitch;
            // Immediate camera apply
            this.camera.rotation.y = this.rotation.yaw;
            this.camera.rotation.x = this.rotation.pitch;
        }

        this.velocity.set(0, 0, 0);
        this.weapon.reset();
    }

    setClass(classId) {
        if (!CLASSES[classId]) return;
        this.playerClass = classId;
        this.weapon.setStats(classId);
    }
}
