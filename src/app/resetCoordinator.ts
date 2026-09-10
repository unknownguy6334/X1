export interface ResettableController {
  reset(reason?: string): void | Promise<void>;
}

export function createResetCoordinator() {
  let generation = 0;
  const controllers = new Set<ResettableController>();
  return {
    register(controller: ResettableController) {
      controllers.add(controller);
      return () => controllers.delete(controller);
    },
    reset(reason = 'user-reset') {
      generation += 1;
      for (const controller of Array.from(controllers)) {
        try { void controller.reset(reason); } catch { /* reset must continue for other owners */ }
      }
      return generation;
    },
    currentGeneration() { return generation; },
  };
}

export const RESET_COORDINATOR = createResetCoordinator();
