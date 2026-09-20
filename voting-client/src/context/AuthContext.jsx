import {
  createContext,
  useContext,
  useState
} from "react";

const AuthContext = createContext(null);

function AuthProvider({ children }) {

  const [user, setUser] = useState(() => {
    try {
      const savedUser =
        sessionStorage.getItem("votesphereUser");

      return savedUser
        ? JSON.parse(savedUser)
        : null;

    } catch {
      return null;
    }
  });

  const login = (userData) => {

    setUser(userData);

    sessionStorage.setItem(
      "votesphereUser",
      JSON.stringify(userData)
    );

  };

  const logout = () => {

    setUser(null);

    sessionStorage.removeItem(
      "votesphereUser"
    );

  };

  return (
    <AuthContext.Provider
      value={{
        user,
        login,
        logout
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

function useAuth() {
  return useContext(AuthContext);
}

export {
  AuthProvider,
  useAuth
};