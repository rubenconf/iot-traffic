# iot-traffic
## Inspiration
We’ve all been there: standing at a pedestrian crossing, waiting for a light to turn green when there isn’t a single car in sight. Or conversely, watching cars idle and pollute at an empty crossing just because a timer said so. Traditional traffic lights in bustling cities like Barcelona rely on rigid, outdated timers or unhygienic physical push-buttons. We wanted to build a solution that respects citizens' time, reduces urban emissions, and brings pedestrian crossings into the 21st century.

## What it does
**IOT-Traffic** is an intelligent, sensor-driven traffic management system. 

- **Smart Detection:** Instead of forcing pedestrians to press a dirty physical button, our system uses IoT sensors to automatically detect when someone is waiting at the curb.
- **Dynamic Flow:** It instantly sends a signal to the traffic light controller to request a crossing phase, minimizing unnecessary wait times for both pedestrians and drivers.
- **Eco-Friendly & Efficient:** By eliminating useless stops, we improve vehicular circulation, reduce the noise and air pollution caused by constant stop-and-go acceleration, and keep the city moving.
## How we built it

* **AI & Machine Learning (TinyML):** We used **Edge Impulse** to train a lightweight computer vision model capable of detecting human presence at the curb. 
* **Hardware & IoT:** We deployed the trained model onto an **Arduino** paired with a **Logitech webcam** to run real-time inference at the edge.
* **Connectivity & Software:** Developed the system using the **Arduino Lab App**, bridging the hardware with a local backend using **WebSockets** in **JavaScript** and **Python** to trigger the traffic light cycle instantly.
## Accomplishments that we're proud of
- **Fully Functional Prototype:** Successfully built a working end-to-end demo where the sensor dynamically triggers the traffic light cycle.
- **An Elegant Solution to a Common Pain Point:** Turning a daily frustration (dirty buttons, empty red lights) into a seamless, automatic, and touch-free experience.

## What we learned
**IoT & Edge Computing:** Gained deeper insights into how low-power hardware sensors can be integrated with city-scale infrastructure.
