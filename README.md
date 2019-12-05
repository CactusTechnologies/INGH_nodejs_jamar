
# @lab100/INGH_nodejs_jamar

![hero](https://static.lab100.org/repo-hero.png)

> NodeJS server for sniffing Bluetooth traffic from the Jamar Dynanometer

---

## Table of contents

- [Installation](#installation)
- [Maintainers](#maintainers)
- [License](#license)

## Installation

```sh
git clone git@github.com:CactusTechnologies/INGH_nodejs_jamar.git INGH_nodejs_jamar
  cd INGH_nodejs_jamar
  npm install
```

##  Run

- run `pm2 start ecosystem.json`
- send a websocket message `strength/start` to begin the bluetooth streaming from the jamar.

## Maintainers

- [Craig Pickard](mailto:craig@cactus.is)
- [Joel Niedfeldt](mailto:joel@cactus.is)

## License

[UNLICENSED](LICENSE) © [Cactus Technologies, LLC](http://www.cactus.is)

