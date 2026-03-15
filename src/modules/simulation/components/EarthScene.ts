import * as THREE from 'three';

export class EarthScene {
    private earth: THREE.Group;
    private sphere: THREE.Mesh;
    private nightLayer: THREE.Mesh | null = null;
    private readonly RADIUS = 6371; // Earth radius in km
    private dataLayers: Map<string, THREE.Mesh> = new Map();
    private textureLoader: THREE.TextureLoader = new THREE.TextureLoader();

    private textures: Record<string, THREE.Texture> = {};

    private sunDirection: THREE.Vector3 = new THREE.Vector3(1, 0, 0);

    constructor(scene: THREE.Scene) {
        this.earth = new THREE.Group();
        (this.earth as any).isEarthGroup = true;
        this.textureLoader.setCrossOrigin('anonymous');

        // Preload common textures
        this.textures['night'] = this.textureLoader.load('https://unpkg.com/three-globe/example/img/earth-night.jpg');
        this.textures['blue'] = this.textureLoader.load('https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg');
        this.textures['dark'] = this.textureLoader.load('https://unpkg.com/three-globe/example/img/earth-dark.jpg');
        this.textures['white'] = this.textureLoader.load('https://unpkg.com/three-globe/example/img/earth-topology.png');


        // Earth Geometry
        const geometry = new THREE.SphereGeometry(this.RADIUS, 128, 128);

        // Custom Shader Material for Day/Night blending
        const material = new THREE.ShaderMaterial({
            uniforms: {
                dayTexture: { value: this.textures['blue'] },
                nightTexture: { value: this.textures['night'] },
                sunDirection: { value: this.sunDirection },
                showDayNight: { value: 1.0 }
            },
            transparent: false,
            depthWrite: true,
            vertexShader: `
                #include <common>
                #include <logdepthbuf_pars_vertex>
                varying vec2 vUv;
                varying vec3 vWorldNormal;
                void main() {
                    vUv = uv;
                    vWorldNormal = normalize(mat3(modelMatrix) * normal);
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                    #include <logdepthbuf_vertex>
                }
            `,
            fragmentShader: `
                #include <common>
                #include <logdepthbuf_pars_fragment>
                uniform sampler2D dayTexture;
                uniform sampler2D nightTexture;
                uniform vec3 sunDirection;
                uniform float showDayNight;
                varying vec2 vUv;
                varying vec3 vWorldNormal;
                void main() {
                    vec3 sunDir = normalize(sunDirection);
                    float intensity = dot(normalize(vWorldNormal), sunDir);
                    vec4 dayColor = texture2D(dayTexture, vUv);
                    vec4 nightColor = texture2D(nightTexture, vUv);
                    if (dayColor.a < 0.1) dayColor = vec4(0.05, 0.1, 0.2, 1.0);
                    if (nightColor.a < 0.1) nightColor = vec4(0.0, 0.01, 0.02, 1.0);
                    float mixStep = smoothstep(-0.15, 0.15, intensity);
                    if (showDayNight > 0.5) {
                        vec4 nightBase = mix(vec4(0.0, 0.02, 0.05, 1.0), nightColor, 0.8);
                        gl_FragColor = mix(nightBase, dayColor, mixStep);
                    } else {
                        gl_FragColor = dayColor;
                    }
                    #include <logdepthbuf_fragment>
                }
            `
        });

        this.sphere = new THREE.Mesh(geometry, material);
        this.earth.add(this.sphere);

        // ⭐ STAR BACKGROUND
        const starsTexture = this.textureLoader.load('https://unpkg.com/three-globe/example/img/night-sky.png');
        scene.background = starsTexture;

        // ⭐ DATA LAYERS - Increased offsets slightly for better depth precision
        this.dataLayers.set('temperature', this.createDataLayer(0xff3300, 50, 0.2, true));
        this.dataLayers.set('co2', this.createDataLayer(0x00ffaa, 65, 0.1, true));
        this.dataLayers.set('ocean', this.createDataLayer(0x0066ff, 25, 0.35, true));
        this.dataLayers.set('sealevel', this.createDataLayer(0x00ffff, 40, 0.2, true));
        this.dataLayers.set('ice', this.createDataLayer(0xffffff, 30, 0.4, false));
        this.dataLayers.set('gravity', this.createDataLayer(0x9900ff, 80, 0.15, true));
    }

    private createDataLayer(color: number, radiusOffset: number, opacity: number, additive: boolean): THREE.Mesh {
        const geometry = new THREE.SphereGeometry(this.RADIUS + radiusOffset, 128, 128);
        const material = new THREE.MeshBasicMaterial({
            color,
            transparent: true,
            opacity,
            blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
            depthWrite: false,
            side: THREE.FrontSide
        });

        const mesh = new THREE.Mesh(geometry, material);
        mesh.visible = false;
        this.earth.add(mesh);
        return mesh;
    }

    getGroup(): THREE.Group {
        return this.earth;
    }

    update(_viewVector: THREE.Vector3, visibleLayers: string[] = [], selectedMap: string = 'night', showDayNight: boolean = false, sunPos?: THREE.Vector3): void {
        const mat = this.sphere.material as THREE.ShaderMaterial;

        if (sunPos) {
            mat.uniforms.sunDirection.value.copy(sunPos);
        }

        mat.uniforms.showDayNight.value = showDayNight ? 1.0 : 0.0;

        // Map texture switching
        let dayTexKey = selectedMap;
        if (selectedMap === 'night') dayTexKey = 'blue';

        const dayTex = this.textures[dayTexKey] || this.textures['blue'];
        if (mat.uniforms.dayTexture.value !== dayTex) {
            mat.uniforms.dayTexture.value = dayTex;
        }

        // For white map, disable day/night blending impact by setting nightTexture to same as day
        if (selectedMap === 'white') {
            mat.uniforms.nightTexture.value = dayTex;
        } else {
            mat.uniforms.nightTexture.value = this.textures['night'];
        }

        // Earth rotation
        // Earth rotation - Disabled to maintain coordinate synchronization with lat/lon
        // this.sphere.rotation.y += 0.00005;

        // Data layers visibility and rotation
        const layers = Array.isArray(visibleLayers) ? visibleLayers : [];

        // Data layers rotation - Disabled for synchronization
        this.dataLayers.forEach((mesh, id) => {
            mesh.visible = layers.includes(id);
        });
    }
}
