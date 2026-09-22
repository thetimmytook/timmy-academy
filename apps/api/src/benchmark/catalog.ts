import type { Hardware } from '@timmy/contracts';

export const hardwareCatalog: readonly Hardware[] = [
  {
    cpu: { id: 'ryzen-7-7800x3d', name: 'Ryzen 7 7800X3D' },
    gpu: { id: 'geforce-rtx-4070-super', name: 'GeForce RTX 4070 SUPER' },
    ram_gb: 32,
  },
  {
    cpu: { id: 'ryzen-7-7800x3d', name: 'Ryzen 7 7800X3D' },
    gpu: { id: 'geforce-rtx-4070-super', name: 'GeForce RTX 4070 SUPER' },
    ram_gb: 64,
  },
  {
    cpu: { id: 'core-i5-12400f', name: 'Core i5-12400F' },
    gpu: { id: 'geforce-rtx-3060-ti', name: 'GeForce RTX 3060 Ti' },
    ram_gb: 16,
  },
];
export const mapCatalog = [
  { id: 'lighthouse', name: 'Lighthouse' },
  { id: 'customs', name: 'Customs' },
  { id: 'streets', name: 'Streets of Tarkov' },
  { id: 'woods', name: 'Woods' },
];
