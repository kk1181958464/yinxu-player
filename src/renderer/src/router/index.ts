import { createRouter, createWebHashHistory } from 'vue-router'
import Home from '../views/Home.vue'
import Search from '../views/Search.vue'
import Library from '../views/Library.vue'
import Playlist from '../views/Playlist.vue'
import Vip from '../views/Vip.vue'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'home', component: Home },
    { path: '/search', name: 'search', component: Search },
    { path: '/library', name: 'library', component: Library },
    { path: '/vip', name: 'vip', component: Vip },
    { path: '/playlist/:id', name: 'playlist', component: Playlist },
    { path: '/:pathMatch(.*)*', redirect: { name: 'home' } }
  ]
})

export default router
