/** Aucune destination d'export : ni l'ordinateur, ni un projet coché. */
export const noDestination = (toComputer: boolean, projects: string[]) => !toComputer && projects.length === 0;
