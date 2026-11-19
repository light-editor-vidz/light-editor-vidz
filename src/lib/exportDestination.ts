/** Aucune destination d'export : ni l'ordinateur, ni un projet coché, ni le média d'origine. */
export const noDestination = (toComputer: boolean, projects: string[], toOrigin = false) =>
  !toComputer && projects.length === 0 && !toOrigin;
