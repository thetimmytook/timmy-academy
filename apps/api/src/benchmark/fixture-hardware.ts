import type { Hardware } from '@timmy/contracts';

export const syntheticUmaHardware: Hardware = {
  cpu: {
    id: 'cpu-ef2011b719dd38ea305c6d786de7780b32156c7cce1783ab08b19f582f7bd1ca',
    name: 'Ryzen 7 7840U',
  },
  gpu: {
    id: 'gpu-9ea273b6a3e5caa6c3b198a8cf5d917db84ca236c1e0c746151154756020a46f',
    name: 'Radeon 780M',
  },
  ram_gb: 32,
};

// Test/seed data only. IDs follow the same SHA-256 name rule as real models.
export const syntheticHardware: readonly Hardware[] = [
  {
    cpu: {
      id: 'cpu-ac225bb136f5c3f6681e28a53b3195f986b04815d2961852b3ba5f1a29e122d1',
      name: 'Ryzen 7 7800X3D',
    },
    gpu: {
      id: 'gpu-6bfdb94a69337e5c975508bac8b078a90c2627bcfe52aa29b97980c9b9cd4bea',
      name: 'GeForce RTX 4070 SUPER',
    },
    ram_gb: 32,
  },
  {
    cpu: {
      id: 'cpu-ac225bb136f5c3f6681e28a53b3195f986b04815d2961852b3ba5f1a29e122d1',
      name: 'Ryzen 7 7800X3D',
    },
    gpu: {
      id: 'gpu-6bfdb94a69337e5c975508bac8b078a90c2627bcfe52aa29b97980c9b9cd4bea',
      name: 'GeForce RTX 4070 SUPER',
    },
    ram_gb: 64,
  },
  {
    cpu: {
      id: 'cpu-78a9f4c21f1d19cde9c43d202b615239aa49a45ac3ae734904f176118a25f6d5',
      name: 'Core i5-12400F',
    },
    gpu: {
      id: 'gpu-b4dd8497c9f5944e496b7ed1db3f78c4a1c9500fb26c2c80854c4cc8934c3874',
      name: 'GeForce RTX 3060 Ti',
    },
    ram_gb: 16,
  },
];
