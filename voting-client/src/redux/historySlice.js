import { createSlice } from '@reduxjs/toolkit';
import { fetchSessionHistory, fetchSessionResult } from '../services/history.js';

export const initialState = {
  items: [],
  loading: false,
  error: null,
  selectedResult: null,
  resultLoading: false,
  resultError: null
};

export const historySlice = createSlice({
  name: 'history',
  initialState,
  reducers: {
    historyLoading: (state) => {
      state.loading = true;
      state.error = null;
    },
    historySuccess: (state, action) => {
      state.loading = false;
      state.items = Array.isArray(action.payload) ? action.payload : [];
      state.error = null;
    },
    historyFailure: (state, action) => {
      state.loading = false;
      state.error = action.payload || 'Failed to load history';
    },
    resultLoading: (state) => {
      state.resultLoading = true;
      state.resultError = null;
    },
    resultSuccess: (state, action) => {
      state.resultLoading = false;
      state.selectedResult = action.payload || null;
      state.resultError = null;
    },
    resultFailure: (state, action) => {
      state.resultLoading = false;
      state.resultError = action.payload || 'Failed to load result';
    },
    clearSelectedResult: (state) => {
      state.selectedResult = null;
      state.resultLoading = false;
      state.resultError = null;
    },
    resetHistoryState: () => initialState
  }
});

export const {
  historyLoading,
  historySuccess,
  historyFailure,
  resultLoading,
  resultSuccess,
  resultFailure,
  clearSelectedResult,
  resetHistoryState
} = historySlice.actions;

// Async Thunk Actions
export const loadHistory = (limit = 50) => async (dispatch) => {
  dispatch(historyLoading());
  const res = await fetchSessionHistory(limit);
  if (res.success) {
    dispatch(historySuccess(res.results));
  } else {
    dispatch(historyFailure(res.message || res.error));
  }
  return res;
};

export const loadSessionResult = (sessionId) => async (dispatch) => {
  dispatch(resultLoading());
  const res = await fetchSessionResult(sessionId);
  if (res.success) {
    dispatch(resultSuccess(res.result));
  } else {
    dispatch(resultFailure(res.message || res.error));
  }
  return res;
};

// Selectors
export const selectHistoryItems = (state) => state.history?.items || [];
export const selectHistoryLoading = (state) => Boolean(state.history?.loading);
export const selectHistoryError = (state) => state.history?.error || null;
export const selectSelectedResult = (state) => state.history?.selectedResult || null;
export const selectResultLoading = (state) => Boolean(state.history?.resultLoading);
export const selectResultError = (state) => state.history?.resultError || null;

export default historySlice.reducer;
