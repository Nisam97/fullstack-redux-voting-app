import { createSlice } from '@reduxjs/toolkit';

export const initialState = {
  isLoggedIn: false,
  user: null,
  loading: false,
  error: null
};

const voterAuthSlice = createSlice({
  name: 'voterAuth',
  initialState,
  reducers: {
    setVoterAuth(state, action) {
      state.isLoggedIn = Boolean(action.payload?.user);
      state.user = action.payload?.user || null;
      state.loading = false;
      state.error = null;
    },
    clearVoterAuth(state) {
      state.isLoggedIn = false;
      state.user = null;
      state.loading = false;
      state.error = null;
    },
    setVoterLoading(state, action) {
      state.loading = Boolean(action.payload);
    },
    setVoterError(state, action) {
      state.error = action.payload || null;
      state.loading = false;
    }
  }
});

export const { setVoterAuth, clearVoterAuth, setVoterLoading, setVoterError } = voterAuthSlice.actions;

export const selectVoterAuth = (state) => state.voterAuth || initialState;
export const selectCurrentVoter = (state) => (state.voterAuth ? state.voterAuth.user : null);
export const selectIsVoterLoggedIn = (state) => Boolean(state.voterAuth && state.voterAuth.isLoggedIn);

export default voterAuthSlice.reducer;
