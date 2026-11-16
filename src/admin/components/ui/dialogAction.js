/** One confirmation at a time, including clicks before React renders the busy state. */
export const createDialogAction = (notify) => {
  let active = null;

  return {
    get pending() { return active !== null; },
    reset() {
      active = null;
      notify({ pending: false, error: '' });
    },
    // Closing/unmounting invalidates callbacks without cancelling the server action.
    invalidate() { active = null; },
    async run(action) {
      if (active) return false;
      const token = {};
      active = token;
      notify({ pending: true, error: '' });
      try {
        await action?.();
        return active === token;
      } catch (error) {
        if (active === token) notify({
          pending: true,
          error: typeof error?.message === 'string' && error.message.trim()
            ? error.message
            : 'Amal bajarilmadi. Qayta urinib ko‘ring.',
        });
        return false;
      } finally {
        if (active === token) {
          active = null;
          notify((state) => ({ ...state, pending: false }));
        }
      }
    },
  };
};
