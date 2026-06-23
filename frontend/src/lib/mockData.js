// Mock data matching the /api/resources shape from API_CONTRACT.md.
// Replaced in Milestone 2 when the WebSocket stream is wired up.
export const mockNodes = [
  {
    id: 'pve1',
    status: 'online',
    cpu: 0.12,
    maxcpu: 8,
    mem: 8_800_000_000,
    maxmem: 34_000_000_000,
    disk: 340_000_000_000,
    maxdisk: 512_000_000_000,
    uptime: 1_209_600,
    managed: true,
    vms: [
      { vmid: 101, name: 'jellyfin', status: 'running', cpu: 0.04, mem: 2_100_000_000, maxmem: 4_000_000_000, disk: null, uptime: 86_000 },
      { vmid: 102, name: 'nextcloud', status: 'stopped', cpu: 0, mem: 0, maxmem: 2_000_000_000, disk: null, uptime: 0 },
    ],
    lxcs: [
      { vmid: 201, name: 'pihole', status: 'running', cpu: 0.01, mem: 180_000_000, maxmem: 512_000_000, disk: 900_000_000, maxdisk: 4_000_000_000, uptime: 86_400 },
      { vmid: 202, name: 'nginx-proxy', status: 'running', cpu: 0.02, mem: 250_000_000, maxmem: 512_000_000, disk: 1_200_000_000, maxdisk: 4_000_000_000, uptime: 172_800 },
    ],
  },
]
