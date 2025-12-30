export class AudioManager {
    constructor() {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.buffers = {};
        this.muted = false;

        // Resume context on user interaction if suspended
        if (this.ctx.state === 'suspended') {
            const resumeAudio = () => {
                this.ctx.resume();
                document.removeEventListener('click', resumeAudio);
                document.removeEventListener('keydown', resumeAudio);
            };
            document.addEventListener('click', resumeAudio);
            document.addEventListener('keydown', resumeAudio);
        }

        this.loadSounds();
    }

    async loadSounds() {
        const sounds = {
            shot: '/assets/shot.mp3',
            hit: '/assets/hit.mp3',
            killed: '/assets/killed.mp3',
            headshot: '/assets/headshot.mp3'
        };

        for (const [name, url] of Object.entries(sounds)) {
            try {
                const response = await fetch(url);
                const arrayBuffer = await response.arrayBuffer();
                const audioBuffer = await this.ctx.decodeAudioData(arrayBuffer);
                this.buffers[name] = audioBuffer;
            } catch (error) {
                console.error(`Failed to load sound ${name} from ${url}:`, error);
            }
        }
    }

    playSound(name, volume = 1.0) {
        if (this.muted || !this.buffers[name]) return;

        // Resume context if needed
        if (this.ctx.state === 'suspended') {
            this.ctx.resume();
        }

        const source = this.ctx.createBufferSource();
        source.buffer = this.buffers[name];

        const gainNode = this.ctx.createGain();
        gainNode.gain.value = volume;

        source.connect(gainNode);
        gainNode.connect(this.ctx.destination);

        source.start(0);
    }

    playShot() {
        // Randomize pitch slightly for variety
        if (this.buffers['shot']) {
            const source = this.ctx.createBufferSource();
            source.buffer = this.buffers['shot'];

            // Random pitch between 0.95 and 1.05
            source.playbackRate.value = 0.95 + Math.random() * 0.1;

            const gainNode = this.ctx.createGain();
            // Shots are loud
            gainNode.gain.value = 0.5;

            source.connect(gainNode);
            gainNode.connect(this.ctx.destination);

            if (this.ctx.state === 'suspended') this.ctx.resume();
            source.start(0);
        }
    }

    playHit() {
        this.playSound('hit', 0.8);
    }

    playKilled() {
        this.playSound('killed', 1.0);
    }

    playHeadshotKill() {
        this.playSound('headshot', 1.0);
    }
}
