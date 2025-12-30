import { GAME_CONSTANTS, CLASSES } from '../../shared/constants.js';

export class Player {
    constructor(id, socket, nickname, position = { x: 0, y: 0, z: 0 }, rotation = { pitch: 0, yaw: 0 }) {
        this.id = id;
        this.socket = socket;
        this.nickname = nickname;
        this.position = position;
        this.rotation = rotation;
        this.velocity = { x: 0, y: 0, z: 0 };

        // Game State
        this.health = GAME_CONSTANTS.MAX_HEALTH;
        this.isDead = false;
        this.kills = 0;
        this.deaths = 0;

        // Weapon State
        this.ammo = GAME_CONSTANTS.MAGAZINE_SIZE;
        this.reserveAmmo = GAME_CONSTANTS.RESERVE_AMMO;
        this.isScoped = false;

        // Class System
        this.playerClass = 'SNIPER'; // Default

        // Flags
        this.wantsRematch = false;
        this.isBot = false;
    }

    setClass(classId) {
        if (CLASSES[classId]) {
            this.playerClass = classId;
            // Optional: Adjust HP if classes have different max HP
            // this.maxHealth = CLASSES[classId].hp; 
            // this.health = this.maxHealth;
        }
    }

    takeDamage(amount) {
        if (this.isDead) return false;

        this.health -= amount;

        if (this.health <= 0) {
            this.health = 0;
            this.isDead = true;
            return true; // Fatal
        }

        return false; // Not fatal
    }

    reset(infiniteAmmo = false) {
        this.health = GAME_CONSTANTS.MAX_HEALTH;
        this.isDead = false;
        this.isScoped = false;

        const classStats = CLASSES[this.playerClass] || CLASSES.SNIPER;
        this.ammo = infiniteAmmo ? 999 : classStats.magazineSize;
        this.reserveAmmo = infiniteAmmo ? 999 : classStats.reserveAmmo;

        this.wantsRematch = false;
    }
}
