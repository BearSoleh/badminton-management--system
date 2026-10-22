import { useCallback,useEffect,useRef,useState } from 'react'
import { useAuth } from '../features/auth/auth-context'
import { MembershipChanged } from '../features/sessions/api'

export function useResource<T>(key:string,loader:()=>Promise<T>) {
  const {refresh}=useAuth()
  const [resource,setResource]=useState<{key:string;data?:T;error?:string}>({key})
  const generation=useRef(0)
  const reload=useCallback(async()=>{
    const request=++generation.current
    try{const data=await loader();if(request===generation.current)setResource({key,data});return data}
    catch(error){if(request===generation.current){setResource({key,error:error instanceof Error?error.message:'Unable to load. Please try again.'});if(error instanceof MembershipChanged)await refresh()}return undefined}
  },[key,loader,refresh])
  useEffect(()=>{
    let active=true
    const request=++generation.current
    loader().then(data=>{if(active&&request===generation.current)setResource({key,data})})
      .catch(error=>{if(active&&request===generation.current){setResource({key,error:error instanceof Error?error.message:'Unable to load. Please try again.'});if(error instanceof MembershipChanged)void refresh()}})
    return()=>{active=false}
  },[key,loader,refresh])
  return {data:resource.key===key?resource.data:undefined,error:resource.key===key?resource.error:undefined,reload}
}
