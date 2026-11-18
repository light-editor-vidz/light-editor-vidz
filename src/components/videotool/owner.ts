import { createContext, useContext } from "react";

/** L'identifiant de l'onglet Vidéo : l'aperçu, l'annulation et la progression lui sont propres. */
const OwnerContext = createContext("");
export const VideoOwnerProvider = OwnerContext.Provider;
export const useVideoOwner = () => useContext(OwnerContext);
