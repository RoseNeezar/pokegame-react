import React, { Component } from 'react'
import './Pokecard.css'
const POKE_API = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/";

export default class Pokecard extends Component {
  render() {
    const POKE_URL = `${POKE_API}${this.props.id}.png`;
    return (
      <div className="Pokecard">
        <h1>{this.props.name}</h1>
        <img src={POKE_URL} alt=""/>
        <h2>TYPE: {this.props.type}</h2>
        <h2>EXP: {this.props.exp}</h2>
      </div>
    )
  }
}
