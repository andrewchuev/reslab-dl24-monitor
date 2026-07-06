// Picks which serial port to try first when the app doesn't yet know which
// one the DL24 is on. The device is a generic USB-serial adapter (no
// distinguishing VID/PID to filter on), so "detection" means actually
// probing candidate ports with the real protocol - see buildCandidateQueue's
// caller in Dashboard.tsx - starting from the highest port number down,
// since the DL24 typically enumerates as the last (or second-to-last) port
// on the system.

function extractPortNumber(name: string): number {
  const match = name.match(/(\d+)(?!.*\d)/);
  return match ? parseInt(match[1], 10) : -1;
}

export function sortPortsDescending(ports: string[]): string[] {
  return [...ports].sort((a, b) => {
    const na = extractPortNumber(a);
    const nb = extractPortNumber(b);
    if (na !== nb) return nb - na;
    return b.localeCompare(a);
  });
}

/**
 * Builds the ordered list of ports to try. The previously-used port (if it's
 * still present) goes first since it's the most likely match; the rest
 * follow in descending order as the auto-detect fallback.
 */
export function buildCandidateQueue(ports: string[], lastPort: string | null): string[] {
  const sorted = sortPortsDescending(ports);
  if (lastPort && sorted.includes(lastPort)) {
    return [lastPort, ...sorted.filter((p) => p !== lastPort)];
  }
  return sorted;
}
