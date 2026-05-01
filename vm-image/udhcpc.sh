#!/oono-arm64/busybox sh
# Minimal busybox udhcpc handler. Applies the lease that udhcpc receives:
# IP/netmask, default route, and DNS.

[ -z "$1" ] && exit 1
PATH=/oono-arm64
export PATH

case "$1" in
    deconfig)
        busybox ifconfig "$interface" 0.0.0.0 || true
        ;;
    renew|bound)
        busybox ifconfig "$interface" "$ip" netmask "${subnet:-255.255.255.0}"
        if [ -n "${router:-}" ]; then
            for r in $router; do
                busybox route add default gw "$r" dev "$interface"
            done
        fi
        : > /etc/resolv.conf
        if [ -n "${domain:-}" ]; then
            echo "search $domain" >> /etc/resolv.conf
        fi
        if [ -n "${dns:-}" ]; then
            for d in $dns; do
                echo "nameserver $d" >> /etc/resolv.conf
            done
        else
            # Fallback in case DHCP didn't include DNS.
            echo "nameserver 1.1.1.1" >> /etc/resolv.conf
            echo "nameserver 8.8.8.8" >> /etc/resolv.conf
        fi
        echo "[udhcpc] $interface=$ip via ${router:-?} dns=${dns:-fallback}"
        ;;
esac
exit 0
