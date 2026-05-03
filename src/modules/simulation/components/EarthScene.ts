import * as THREE from 'three';
import type { MapType } from '../modules/types';
import {
    getSimulationMapStyle,
    SIMULATION_DATA_LAYER_STYLES,
    SIMULATION_NIGHT_TEXTURE,
    SIMULATION_SKY_TEXTURE
} from '../utils/mapStyles';
import { TiledGlobeLayer } from './TiledGlobeLayer';

export class EarthScene {
    private earth: THREE.Group;
    private sphere: THREE.Mesh;
    private readonly RADIUS = 6371; // Earth radius in km
    private dataLayers: Map<string, THREE.Mesh> = new Map();
    private tiledGlobeLayer: TiledGlobeLayer;
    private onlineNightOverlay: THREE.Mesh;
    private textureLoader: THREE.TextureLoader = new THREE.TextureLoader();

    private textures: Record<string, THREE.Texture> = {};

    private sunDirection: THREE.Vector3 = new THREE.Vector3(1, 0, 0);

    constructor(scene: THREE.Scene, private readonly onlineMapEnabled: boolean) {
        this.earth = new THREE.Group();
        (this.earth as any).isEarthGroup = true;
        this.textureLoader.setCrossOrigin('anonymous');

        // Local fallback textures keep the globe usable online and offline.
        this.textures['night'] = this.loadTexture(SIMULATION_NIGHT_TEXTURE);
        this.textures['dark'] = this.loadTexture(getSimulationMapStyle('dark').fallbackTexture);
        this.textures['satellite'] = this.loadTexture(getSimulationMapStyle('satellite').fallbackTexture);


        // Earth Geometry
        const geometry = new THREE.SphereGeometry(this.RADIUS, 128, 128);

        // Custom Shader Material for Day/Night blending
        const material = new THREE.ShaderMaterial({
            uniforms: {
                dayTexture: { value: this.textures['dark'] },
                nightTexture: { value: this.textures['night'] },
                sunDirection: { value: this.sunDirection },
                showDayNight: { value: 1.0 },
                brightness: { value: 0.78 },
                contrast: { value: 1.08 },
                mode: { value: 0.0 },
                onlineBaseActive: { value: 0.0 },
                background: { value: new THREE.Color(0x030b12) }
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
                uniform float brightness;
                uniform float contrast;
                uniform float mode;
                uniform float onlineBaseActive;
                uniform vec3 background;
                varying vec2 vUv;
                varying vec3 vWorldNormal;
                void main() {
                    vec3 sunDir = normalize(sunDirection);
                    float intensity = dot(normalize(vWorldNormal), sunDir);
                    float lit = smoothstep(-0.22, 0.2, intensity);
                    if (onlineBaseActive > 0.5) {
                        vec3 base = mode < 0.5 ? vec3(0.012, 0.04, 0.066) : vec3(0.045, 0.06, 0.07);
                        if (showDayNight > 0.5) {
                            float nightMask = 1.0 - lit;
                            float shadow = mix(mode < 0.5 ? 0.18 : 0.3, 1.0, lit);
                            vec3 nightColor = texture2D(nightTexture, vUv).rgb;
                            vec3 nightDetail = nightColor * (mode < 0.5 ? 0.18 : 0.15) * nightMask;
                            vec3 nightTint = mode < 0.5 ? vec3(0.0, 0.012, 0.035) : vec3(0.0, 0.018, 0.05);
                            float tintStrength = nightMask * (mode < 0.5 ? 0.62 : 0.48);
                            gl_FragColor = vec4(mix(base * shadow + nightDetail, nightTint + nightDetail, tintStrength), 1.0);
                        } else {
                            gl_FragColor = vec4(base, 1.0);
                        }
                        #include <logdepthbuf_fragment>
                        return;
                    }
                    vec4 dayColor = texture2D(dayTexture, vUv);
                    vec4 nightColor = texture2D(nightTexture, vUv);
                    if (dayColor.a < 0.1) dayColor = vec4(0.05, 0.1, 0.2, 1.0);
                    if (nightColor.a < 0.1) nightColor = vec4(0.0, 0.01, 0.02, 1.0);
                    vec3 visibleNight = min(vec3(1.0), pow(nightColor.rgb, vec3(0.78)) * 1.45);
                    vec3 baseColor = dayColor.rgb;
                    if (mode < 0.5) {
                        dayColor.rgb = ((baseColor - 0.5) * contrast + 0.5) * brightness * vec3(0.86, 1.06, 1.2) + vec3(0.0, 0.02, 0.04);
                        dayColor.rgb *= 0.46;
                    } else {
                        dayColor.rgb = baseColor;
                    }
                    if (showDayNight > 0.5) {
                        gl_FragColor = vec4(mix(visibleNight, dayColor.rgb, lit), 1.0);
                    } else {
                        gl_FragColor = dayColor;
                    }
                    #include <logdepthbuf_fragment>
                }
            `
        });

        this.sphere = new THREE.Mesh(geometry, material);
        this.earth.add(this.sphere);
        this.tiledGlobeLayer = new TiledGlobeLayer(
            this.earth,
            8,
            onlineMapEnabled
        );
        this.onlineNightOverlay = this.createOnlineNightOverlay();
        this.earth.add(this.onlineNightOverlay);

        // ⭐ STAR BACKGROUND
        const starsTexture = this.loadTexture(SIMULATION_SKY_TEXTURE);
        scene.background = starsTexture;

        // ⭐ DATA LAYERS - Increased offsets slightly for better depth precision
        SIMULATION_DATA_LAYER_STYLES.forEach((layer, index) => {
            this.dataLayers.set(layer.id, this.createDataLayer(layer.color, 35 + index * 12, layer.opacity3d, layer.additive));
        });
    }

    private loadTexture(url: string): THREE.Texture {
        const texture = this.textureLoader.load(url);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.generateMipmaps = true;
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.anisotropy = 8;
        return texture;
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

    private createOnlineNightOverlay(): THREE.Mesh {
        const geometry = new THREE.SphereGeometry(this.RADIUS + 34, 128, 128);
        const material = new THREE.ShaderMaterial({
            uniforms: {
                nightTexture: { value: this.textures['night'] },
                sunDirection: { value: this.sunDirection },
                mode: { value: 0.0 }
            },
            transparent: true,
            depthWrite: false,
            depthTest: true,
            side: THREE.FrontSide,
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
                uniform sampler2D nightTexture;
                uniform vec3 sunDirection;
                uniform float mode;
                varying vec2 vUv;
                varying vec3 vWorldNormal;
                void main() {
                    float intensity = dot(normalize(vWorldNormal), normalize(sunDirection));
                    float lit = smoothstep(-0.22, 0.2, intensity);
                    float nightMask = 1.0 - lit;
                    vec3 nightDetail = texture2D(nightTexture, vUv).rgb * nightMask * (mode < 0.5 ? 0.18 : 0.28);
                    vec3 tint = mode < 0.5 ? vec3(0.0, 0.012, 0.035) : vec3(0.0, 0.012, 0.034);
                    float alpha = nightMask * (mode < 0.5 ? 0.62 : 0.72);
                    gl_FragColor = vec4(tint + nightDetail, alpha);
                    #include <logdepthbuf_fragment>
                }
            `
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = 'online-night-overlay';
        mesh.renderOrder = 3;
        mesh.visible = false;
        return mesh;
    }

    getGroup(): THREE.Group {
        return this.earth;
    }

    update(_viewVector: THREE.Vector3, visibleLayers: string[] = [], selectedMap: MapType = 'dark', showDayNight: boolean = false, sunPos?: THREE.Vector3): void {
        const mat = this.sphere.material as THREE.ShaderMaterial;

        if (sunPos) {
            mat.uniforms.sunDirection.value.copy(sunPos);
        }

        mat.uniforms.showDayNight.value = showDayNight ? 1.0 : 0.0;

        const dayTex = this.textures[selectedMap] || this.textures['dark'];
        if (mat.uniforms.dayTexture.value !== dayTex) {
            mat.uniforms.dayTexture.value = dayTex;
        }

        mat.uniforms.nightTexture.value = this.textures['night'];
        mat.uniforms.brightness.value = selectedMap === 'dark' ? 1.22 : 1.08;
        mat.uniforms.contrast.value = selectedMap === 'dark' ? 1.18 : 1.1;
        mat.uniforms.mode.value = selectedMap === 'dark' ? 0.0 : 1.0;
        mat.uniforms.background.value.setHex(getSimulationMapStyle(selectedMap).background);
        const onlineGlobe = this.tiledGlobeLayer.update(selectedMap);
        mat.uniforms.onlineBaseActive.value = this.onlineMapEnabled ? 1.0 : 0.0;
        this.sphere.visible = true;
        mat.colorWrite = true;
        const overlayMaterial = this.onlineNightOverlay.material as THREE.ShaderMaterial;
        overlayMaterial.uniforms.sunDirection.value.copy(mat.uniforms.sunDirection.value);
        overlayMaterial.uniforms.mode.value = selectedMap === 'dark' ? 0.0 : 1.0;
        this.onlineNightOverlay.visible = this.onlineMapEnabled && onlineGlobe.active && showDayNight;

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

    dispose(): void {
        this.dataLayers.forEach(layer => {
            layer.geometry.dispose();
            (layer.material as THREE.Material).dispose();
        });
        this.sphere.geometry.dispose();
        (this.sphere.material as THREE.Material).dispose();
        this.onlineNightOverlay.geometry.dispose();
        (this.onlineNightOverlay.material as THREE.Material).dispose();
        this.tiledGlobeLayer.dispose();
        Object.values(this.textures).forEach(texture => texture.dispose());
    }
}
