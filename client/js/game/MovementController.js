import { GAME_CONSTANTS, MOVEMENT_STATES } from '../../../shared/constants.js';

export class MovementController {
    constructor(inputManager) {
        this.input = inputManager;

        // State
        this.currentState = MOVEMENT_STATES.WALK;

        // Timers and Timestamps
        this.lastShiftReleaseTime = 0;
        this.superSprintEndTime = 0;
        this.slideEndTime = 0;
        this.slideCooldownEndTime = 0;

        // Flags
        this.wasShiftPressed = false;
    }

    update(deltaTime) {
        const now = Date.now();
        const isShiftPressed = this.input.isKeyDown('ShiftLeft');
        const isCPressed = this.input.isKeyDown('KeyC');
        const isMoving = this.input.getMovementInput().x !== 0 || this.input.getMovementInput().z !== 0;

        // --- DOUBLE SHIFT DETECTION ---
        // Detect shift release
        if (this.wasShiftPressed && !isShiftPressed) {
            // Shift released
            const timeSinceLastRelease = now - this.lastShiftReleaseTime;

            // Check for double tap logic here if needed, but typically detecting Press is better.
            // Let's detect double PREss.
        }

        // Better Double Shift Logic: Detect PRESS event
        // We need impulse detection, not just "isKeyDown".
        // Use a small helper or check transitions.
        if (isShiftPressed && !this.wasShiftPressed) {
            // Shift Just Pressed
            if (now - this.lastShiftReleaseTime < GAME_CONSTANTS.DOUBLE_TAP_WINDOW) {
                this.handleDoubleShift(now);
            }
        }

        if (!isShiftPressed && this.wasShiftPressed) {
            this.lastShiftReleaseTime = now;
        }

        this.wasShiftPressed = isShiftPressed;

        // --- STATE MACHINE ---

        // 1. SLIDE (Highest Priority, Forced Duration)
        if (this.currentState === MOVEMENT_STATES.SLIDE) {
            if (now >= this.slideEndTime) {
                // End Slide
                this.endSlide(isShiftPressed);
            } else {
                // During slide, ignore other inputs, just slide
                return;
            }
        }

        // 2. CHECK FOR SLIDE INPUT
        // Can slide during Sprint or Super Sprint (or even Walk if we want, but guide implies running)
        // Guide says: "Durante corsa normale" or "Durante scatto veloce"
        const canSlide = (this.currentState === MOVEMENT_STATES.SPRINT || this.currentState === MOVEMENT_STATES.SUPER_SPRINT) &&
            isMoving &&
            isCPressed &&
            now >= this.slideCooldownEndTime;

        if (canSlide) {
            this.startSlide(now);
            return;
        }

        // 3. SUPER SPRINT (10s Duration)
        if (this.currentState === MOVEMENT_STATES.SUPER_SPRINT) {
            if (now >= this.superSprintEndTime) {
                // Time's up for Super Sprint
                if (isShiftPressed) {
                    this.currentState = MOVEMENT_STATES.SPRINT;
                } else {
                    this.currentState = MOVEMENT_STATES.WALK;
                }
            } else {
                // Still in Super Sprint time
                // Guide: "Se SHIFT NON è premuto -> torna alla camminata? No, guide says 'Dopo 10 secondi...'"
                // "Fine scatto... se SHIFT non è premuto torna alla camminata". 
                // Implicitly implies if you stop running during 10s you might lose it or it keeps going?
                // "Durata: 10 secondi fissi". Usually means it lasts 10s regardless, OR it acts as a buff.
                // Let's assume it acts as a buff that forces run state, but if user stops moving?
                // Visual consistency: If not moving, state might remain supersprint but velocity 0.

                // CRITICAL: "Se SHIFT non è premuto NON serve ripremere SHIFT".
                // So you can let go of shift and still super sprint?
                // "Fine scatto: Dopo 10 secondi: Se shift premuto -> corsa, se no -> camminata".
                // This implies during the 10s you don't need to hold shift?
                // "Attivazione: Doppio SHIFT... Comportamento... Durata 10 secondi fissi."
                // "NON serve ripremere SHIFT" -> Confirms you don't need to hold it.
            }
        }

        // 4. SPRINT vs WALK
        // Only update if NOT in Super Sprint (timer based) and NOT Sliding
        if (this.currentState !== MOVEMENT_STATES.SUPER_SPRINT && this.currentState !== MOVEMENT_STATES.SLIDE) {
            if (isShiftPressed && isMoving) {
                this.currentState = MOVEMENT_STATES.SPRINT;
            } else {
                this.currentState = MOVEMENT_STATES.WALK;
            }
        }
    }

    handleDoubleShift(now) {
        // Activate Super Sprint
        this.currentState = MOVEMENT_STATES.SUPER_SPRINT;
        this.superSprintEndTime = now + (GAME_CONSTANTS.SUPER_SPRINT_DURATION * 1000);
    }

    startSlide(now) {
        this.previousState = this.currentState; // Remember if we were super sprinting or just sprinting
        this.currentState = MOVEMENT_STATES.SLIDE;
        this.slideEndTime = now + (GAME_CONSTANTS.SLIDE_DURATION * 1000);
    }

    endSlide(isShiftPressed) {
        this.slideCooldownEndTime = Date.now() + (GAME_CONSTANTS.SLIDE_COOLDOWN * 1000);

        // Return to previous state logic
        // Guide: "SHIFT premuto -> ritorna allo stato di corsa attivo (Sprint)"
        // "SHIFT rilasciato -> camminata"
        // BUT ALSO: "La scivolata non resetta scatto..."
        // If we were in SUPER SPRINT and timer is still valid, we should go back to SUPER SPRINT?

        const now = Date.now();
        if (this.previousState === MOVEMENT_STATES.SUPER_SPRINT && now < this.superSprintEndTime) {
            this.currentState = MOVEMENT_STATES.SUPER_SPRINT;
        } else {
            // Standard check
            if (isShiftPressed) {
                this.currentState = MOVEMENT_STATES.SPRINT;
            } else {
                this.currentState = MOVEMENT_STATES.WALK;
            }
        }
    }

    getSpeedModifier() {
        switch (this.currentState) {
            case MOVEMENT_STATES.SLIDE:
                return GAME_CONSTANTS.SLIDE_SPEED / GAME_CONSTANTS.WALK_SPEED;
            case MOVEMENT_STATES.SUPER_SPRINT:
                return GAME_CONSTANTS.SUPER_SPRINT_SPEED / GAME_CONSTANTS.WALK_SPEED;
            case MOVEMENT_STATES.SPRINT:
                return GAME_CONSTANTS.SPRINT_SPEED / GAME_CONSTANTS.WALK_SPEED;
            default:
                return 1.0;
        }
    }

    getState() {
        return this.currentState;
    }
}
