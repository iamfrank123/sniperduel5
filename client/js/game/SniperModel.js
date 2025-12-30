import * as THREE from 'three';
import { HITBOX_TYPES } from '../../../shared/constants.js';

export class SniperModel extends THREE.Group {
    constructor() {
        super();
        this.createModel();
    }

    createModel() {
        // Materials (Low Poly / Flat Shaded)
        const skinMaterial = new THREE.MeshStandardMaterial({
            color: 0xffccaa, // Skin tone
            roughness: 0.8
        });

        const clothingMaterial = new THREE.MeshStandardMaterial({
            color: 0x2E4B2B, // Dark Green / Camo
            roughness: 0.9
        });

        const pantsMaterial = new THREE.MeshStandardMaterial({
            color: 0x333333, // Dark Grey
            roughness: 0.9
        });

        const rifleBodyMaterial = new THREE.MeshStandardMaterial({
            color: 0x1a1a1a, // Matte Black
            roughness: 0.5,
            metalness: 0.5
        });

        const rifleBarrelMaterial = new THREE.MeshStandardMaterial({
            color: 0x050505, // Black Cylinder
            roughness: 0.4,
            metalness: 0.6
        });

        // --- Body Parts ---

        // 1. Head (Cube)
        const headGeo = new THREE.BoxGeometry(0.3, 0.3, 0.3);
        this.head = new THREE.Mesh(headGeo, skinMaterial);
        this.head.position.y = 1.7;
        this.head.userData = { hitbox: HITBOX_TYPES.HEAD };
        this.head.castShadow = true;
        this.add(this.head);

        // 2. Torso (Rectangle)
        // Upper Body
        const upperBodyGeo = new THREE.BoxGeometry(0.5, 0.5, 0.3);
        this.upperBody = new THREE.Mesh(upperBodyGeo, clothingMaterial);
        this.upperBody.position.y = 1.35;
        this.upperBody.userData = { hitbox: HITBOX_TYPES.UPPER_BODY };
        this.upperBody.castShadow = true;
        this.add(this.upperBody);

        // Lower Body (Abdomen/Hips)
        const lowerBodyGeo = new THREE.BoxGeometry(0.45, 0.3, 0.28);
        this.lowerBody = new THREE.Mesh(lowerBodyGeo, clothingMaterial);
        this.lowerBody.position.y = 0.95;
        this.lowerBody.userData = { hitbox: HITBOX_TYPES.LOWER_BODY };
        this.lowerBody.castShadow = true;
        this.add(this.lowerBody);

        // 3. Legs (Thick Boxes)
        const legGeo = new THREE.BoxGeometry(0.18, 0.9, 0.22);

        // Left Leg
        this.leftLeg = new THREE.Mesh(legGeo, pantsMaterial);
        this.leftLeg.position.set(-0.15, 0.45, 0);
        this.leftLeg.userData = { hitbox: HITBOX_TYPES.LEFT_LEG };
        this.leftLeg.castShadow = true;
        this.add(this.leftLeg);

        // Right Leg
        this.rightLeg = new THREE.Mesh(legGeo, pantsMaterial);
        this.rightLeg.position.set(0.15, 0.45, 0);
        this.rightLeg.userData = { hitbox: HITBOX_TYPES.RIGHT_LEG };
        this.rightLeg.castShadow = true;
        this.add(this.rightLeg);

        // 4. Arms (Cylinders/Thin Boxes)
        // Adjusted to hold rifle across chest
        const armGeo = new THREE.BoxGeometry(0.12, 0.6, 0.12);

        // Left Arm (Holding barrel)
        this.leftArm = new THREE.Mesh(armGeo, clothingMaterial);
        this.leftArm.position.set(-0.35, 1.35, 0.2);
        this.leftArm.rotation.z = -0.5; // Angled slightly out
        this.leftArm.rotation.x = -1.2; // Angled forward to hold gun
        this.leftArm.userData = { hitbox: HITBOX_TYPES.LEFT_ARM };
        this.leftArm.castShadow = true;
        this.add(this.leftArm);

        // Right Arm (Trigger hand)
        this.rightArm = new THREE.Mesh(armGeo, clothingMaterial);
        this.rightArm.position.set(0.35, 1.35, 0.1);
        this.rightArm.rotation.z = 0.5;
        this.rightArm.rotation.x = -1.0;
        this.rightArm.userData = { hitbox: HITBOX_TYPES.RIGHT_ARM };
        this.rightArm.castShadow = true;
        this.add(this.rightArm);

        // --- Rifle ---
        this.rifle = new THREE.Group();

        // Main Body (Stock + Receiver)
        const gunBodyGeo = new THREE.BoxGeometry(0.1, 0.12, 0.6);
        const gunBody = new THREE.Mesh(gunBodyGeo, rifleBodyMaterial);
        this.rifle.add(gunBody);

        // Barrel
        const barrelGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.8, 8);
        const barrel = new THREE.Mesh(barrelGeo, rifleBarrelMaterial);
        barrel.rotation.x = Math.PI / 2;
        barrel.position.z = -0.5; // Stick out front
        this.rifle.add(barrel);

        // Scope
        const scopeGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.3, 8);
        const scope = new THREE.Mesh(scopeGeo, rifleBodyMaterial);
        scope.rotation.x = Math.PI / 2;
        scope.position.y = 0.08;
        scope.position.z = -0.1;
        this.rifle.add(scope);

        // Position Rifle across chest
        this.rifle.position.set(0, 1.25, 0.45); // In front of chest
        this.rifle.rotation.y = -Math.PI / 6; // Angled slightly left
        // this.rifle.rotation.x = -0.1; // Slight tip up?

        // Rifle usually doesn't block shots in simple games, or counts as body shot.
        // Let's set userdata to body for simplicity or null to ignore.
        this.rifle.userData = { hitbox: HITBOX_TYPES.UPPER_BODY };
        this.add(this.rifle);
    }
    setName(name) {
        if (this.nameTag) {
            this.remove(this.nameTag);
        }

        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.width = 512;
        canvas.height = 128;

        context.fillStyle = 'rgba(0, 0, 0, 0.5)';
        context.fillRect(0, 0, canvas.width, canvas.height);

        context.font = 'Bold 80px Arial';
        context.fillStyle = '#ff6b6b';
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText(name, canvas.width / 2, canvas.height / 2);

        const texture = new THREE.CanvasTexture(canvas);
        const spriteMaterial = new THREE.SpriteMaterial({ map: texture });
        const sprite = new THREE.Sprite(spriteMaterial);

        sprite.position.y = 2.2; // Above head
        sprite.scale.set(1.5, 0.375, 1);

        this.nameTag = sprite;
        this.add(this.nameTag);
    }
}
