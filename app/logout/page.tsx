"use client";
import { useContext, useEffect } from "react";
import { AuthContext } from "@/src/context/AuthContext";


export default function LogoutPage() {
const { signOut } = useContext(AuthContext);


useEffect(() => {
signOut();
}, []);


return <div className="p-6">Logging out...</div>;
}