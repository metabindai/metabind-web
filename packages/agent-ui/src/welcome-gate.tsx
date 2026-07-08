// Gates the empty-state welcome hero. When the chat is preset with a context
// (or is embedded and waiting on the host's INIT), the thread is briefly empty
// before the seeded message lands — without this gate the welcome screen
// flashes for those frames. `useInitSeed` flips this to `true` only once it has
// resolved that nothing more is going to seed the thread.

import { createContext, useContext, type ReactNode } from "react";

// Default `true` so any consumer rendered outside the provider falls back to
// the old behaviour (welcome shown purely on `isEmpty`).
const WelcomeReadyContext = createContext(true);

export function WelcomeReadyProvider({
    value,
    children,
}: {
    value: boolean;
    children: ReactNode;
}) {
    return (
        <WelcomeReadyContext.Provider value={value}>
            {children}
        </WelcomeReadyContext.Provider>
    );
}

export function useWelcomeReady(): boolean {
    return useContext(WelcomeReadyContext);
}
