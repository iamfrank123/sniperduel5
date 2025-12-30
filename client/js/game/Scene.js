// Scene - Three.js scene setup and rendering
import * as THREE from 'three';
import { MAP_GEOMETRY } from '../../../shared/MapData.js';

export class Scene {
    constructor() {
        this.scene = new THREE.Scene();
        this.camera = null;
        this.renderer = null;

        this.init();
    }

    init() {
        // Setup renderer
        const canvas = document.getElementById('game-canvas');
        this.renderer = new THREE.WebGLRenderer({
            canvas,
            antialias: true
        });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

        // Setup camera
        this.camera = new THREE.PerspectiveCamera(
            75,
            window.innerWidth / window.innerHeight,
            0.1,
            1000
        );
        this.camera.position.set(0, 1.6, 0);

        // Setup lighting
        this.setupLighting();

        // Create environment
        this.createEnvironment();

        // Handle window resize
        window.addEventListener('resize', () => this.onWindowResize());
    }

    setupLighting() {
        // Soft Ambient light with a touch of blue for atmosphere
        const ambientLight = new THREE.AmbientLight(0xddeeff, 0.4);
        this.scene.add(ambientLight);

        // Stronger Directional light (sun)
        const directionalLight = new THREE.DirectionalLight(0xffffff, 1.5);
        directionalLight.position.set(40, 60, -30);
        directionalLight.castShadow = true;

        // Optimize shadow camera for the map size
        directionalLight.shadow.camera.left = -40;
        directionalLight.shadow.camera.right = 40;
        directionalLight.shadow.camera.top = 40;
        directionalLight.shadow.camera.bottom = -40;
        directionalLight.shadow.camera.near = 1;
        directionalLight.shadow.camera.far = 150;
        directionalLight.shadow.mapSize.width = 2048;
        directionalLight.shadow.mapSize.height = 2048;
        directionalLight.shadow.bias = -0.0005;
        this.scene.add(directionalLight);

        // Hemisphere light for natural ground reflection
        const hemisphereLight = new THREE.HemisphereLight(0x87CEEB, 0x444444, 0.6);
        this.scene.add(hemisphereLight);
    }

    createEnvironment() {
        // Professional Gradient-like background
        const skyColor = 0x1a2a4a; // Darker tech-blue
        this.scene.background = new THREE.Color(skyColor);
        this.scene.fog = new THREE.FogExp2(skyColor, 0.012);

        // Dark Industrial Ground
        const groundGeometry = new THREE.PlaneGeometry(200, 200);
        const groundMaterial = new THREE.MeshStandardMaterial({
            color: 0x222222,
            roughness: 0.8,
            metalness: 0.2
        });
        const ground = new THREE.Mesh(groundGeometry, groundMaterial);
        ground.rotation.x = -Math.PI / 2;
        ground.receiveShadow = true;
        this.scene.add(ground);

        // Tech Grid
        const gridHelper = new THREE.GridHelper(100, 40, 0x00ffff, 0x333333);
        gridHelper.material.opacity = 0.15;
        gridHelper.material.transparent = true;
        gridHelper.position.y = 0.01;
        this.scene.add(gridHelper);

        // Factory structures
        this.createComplexStructures();

        // Decorative floating clouds
        this.createClouds();
    }

    createComplexStructures() {
        const wallMaterial = new THREE.MeshStandardMaterial({
            color: 0x333344,
            roughness: 0.4,
            metalness: 0.6
        });

        const accentMaterial = new THREE.MeshStandardMaterial({
            color: 0x00ffff,
            emissive: 0x006666,
            roughness: 0.1,
            metalness: 0.9
        });

        const mapSize = MAP_GEOMETRY.SIZE;
        const wallHeight = MAP_GEOMETRY.WALL_HEIGHT;

        // Perimeter Walls
        const wallGeo = new THREE.BoxGeometry(mapSize, wallHeight, 1);

        // North/South
        const northWall = new THREE.Mesh(wallGeo, wallMaterial);
        northWall.position.set(0, wallHeight / 2, -mapSize / 2);
        northWall.receiveShadow = northWall.castShadow = true;
        this.scene.add(northWall);

        const southWall = northWall.clone();
        southWall.position.z = mapSize / 2;
        this.scene.add(southWall);

        // East/West
        const sideWallGeo = new THREE.BoxGeometry(1, wallHeight, mapSize);
        const eastWall = new THREE.Mesh(sideWallGeo, wallMaterial);
        eastWall.position.set(mapSize / 2, wallHeight / 2, 0);
        this.scene.add(eastWall);

        const westWall = eastWall.clone();
        westWall.position.x = -mapSize / 2;
        this.scene.add(westWall);

        // Cyber Towers from MapData
        const towerGeo = new THREE.BoxGeometry(4, 25, 4);
        MAP_GEOMETRY.TOWERS.forEach(t => {
            const tower = new THREE.Mesh(towerGeo, wallMaterial);
            tower.position.set(t.x, t.height / 2, t.z);
            tower.castShadow = tower.receiveShadow = true;
            this.scene.add(tower);

            // Neon glowing strips
            const strip = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.5, 4.2), accentMaterial);
            strip.position.set(t.x, 20, t.z);
            this.scene.add(strip);
        });

        // Fixed Cover from MapData
        const boxMaterial = new THREE.MeshStandardMaterial({ color: 0x444455, roughness: 0.6 });
        MAP_GEOMETRY.COVER.forEach(c => {
            const cube = new THREE.Mesh(new THREE.BoxGeometry(c.w, c.h, c.d), boxMaterial);
            cube.position.set(c.x, c.h / 2, c.z);
            cube.castShadow = cube.receiveShadow = true;
            this.scene.add(cube);
        });
    }

    createClouds() {
        const cloudGeo = new THREE.SphereGeometry(1, 4, 4);
        const cloudMat = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.4,
            emissive: 0x222222
        });

        for (let i = 0; i < 20; i++) {
            const group = new THREE.Group();
            const numBlobs = 3 + Math.floor(Math.random() * 3);
            for (let j = 0; j < numBlobs; j++) {
                const blob = new THREE.Mesh(cloudGeo, cloudMat);
                blob.position.set(j * 1.5, Math.random(), Math.random());
                blob.scale.setScalar(2 + Math.random() * 3);
                group.add(blob);
            }
            group.position.set(
                (Math.random() - 0.5) * 150,
                30 + Math.random() * 20,
                (Math.random() - 0.5) * 150
            );
            this.scene.add(group);
        }
    }

    onWindowResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    render() {
        this.renderer.render(this.scene, this.camera);
    }

    dispose() {
        // Clean up resources
        this.scene.traverse((object) => {
            if (object.geometry) {
                object.geometry.dispose();
            }
            if (object.material) {
                if (Array.isArray(object.material)) {
                    object.material.forEach(material => material.dispose());
                } else {
                    object.material.dispose();
                }
            }
        });

        this.renderer.dispose();
    }
}
